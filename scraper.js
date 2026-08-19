/**
 * ComparaPC — Scraper de preços atualizado e otimizado
 */

const fs = require("fs");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const LOJAS = [
  {
    nome: "Chip7",
    categorias: ["https://chip7.pt/componentes-hardware/placas-graficas"],
    ehLinkDeProduto: (href) =>
      href.includes("chip7.pt/componentes-hardware/placas-graficas/") &&
      href.split("/").length >= 8,
    urlPagina: (base, n) => `${base}?page=${n}`,
  },
  {
    nome: "PcDiga",
    categorias: [
      "https://www.pcdiga.com/componentes/placas-graficas/placas-graficas-nvidia",
      "https://www.pcdiga.com/componentes/placas-graficas/placas-graficas-amd",
    ],
    ehLinkDeProduto: (href) =>
      href.includes("pcdiga.com/") && href.includes("placa-grafica-"),
    urlPagina: (base, n) => `${base}?page=${n}`,
  },
  {
    nome: "PcComponentes",
    categorias: [
      "https://www.pccomponentes.pt/placas-graficas-nvidia",
      "https://www.pccomponentes.pt/placas-graficas-amd",
    ],
    ehLinkDeProduto: (href) => {
      if (!href.includes("pccomponentes.pt/")) return false;
      const lower = href.toLowerCase();
      if (
        lower.includes("portatil") ||
        lower.includes("desktop") ||
        lower.includes("pccom") ||
        lower.includes("acer-nitro")
      ) {
        return false;
      }
      return lower.includes("placa-grafica") || lower.includes("grafica-");
    },
    urlPagina: (base, n) => `${base}?page=${n}`,
  },
  {
    nome: "Switch Technology",
    categorias: [
      "https://switchtechnology.pt/produto-categoria/componentes/placas-graficas/",
    ],
    ehLinkDeProduto: (href) => {
      const lower = href.toLowerCase();
      return (
        lower.includes("switchtechnology.pt/produto/") ||
        lower.includes("switchtechnology.pt/comprar/")
      );
    },
    urlPagina: (base, n) => `${base}page/${n}/`,
  },
  {
    nome: "Globaldata",
    categorias: [
      "https://www.globaldata.pt/componentes/placas-graficas/placas-graficas-nvidia",
      "https://www.globaldata.pt/componentes/placas-graficas/placas-graficas-amd",
    ],
    ehLinkDeProduto: (href) => {
      const lower = href.toLowerCase();
      if (!lower.endsWith(".html")) return false;
      if (
        lower.includes("computadores-portateis") ||
        lower.includes("portateis-gaming")
      ) {
        return false;
      }
      return true;
    },
    urlPagina: (base, n) => `${base}?page=${n}`,
  },
];

const MAX_PAGINAS_POR_CATEGORIA = 8;

async function main() {
  console.log("A abrir o browser...\n");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
    ],
  });

  let todosOsResultados = [];
  if (fs.existsSync("precos.json")) {
    try {
      todosOsResultados = JSON.parse(fs.readFileSync("precos.json", "utf-8"));
      console.log(`Carregados ${todosOsResultados.length} produtos existentes de precos.json\n`);
    } catch {
      todosOsResultados = [];
    }
  }

  try {
    for (const loja of LOJAS) {
      console.log(`\n=== ${loja.nome} ===`);

      let linksDeProdutos;
      try {
        linksDeProdutos = await descobrirProdutos(browser, loja);
      } catch (erro) {
        console.log(`  ⚠️  Falhou a descobrir produtos de ${loja.nome} (${erro.message}) — a passar à seguinte.`);
        continue;
      }
      console.log(`  ${linksDeProdutos.size} produto(s) encontrado(s).`);

      for (const url of linksDeProdutos) {
        if (todosOsResultados.some((p) => p.url === url)) {
          continue;
        }

        let resultado = null;
        try {
          resultado = await processarProduto(browser, url, loja.nome);
        } catch (erro) {
          console.log(`  ⚠️  Erro a processar produto (${erro.message}) — a continuar.`);
        }

        if (resultado) {
          todosOsResultados.push(resultado);
          
          try {
            fs.writeFileSync(
              "precos.json",
              JSON.stringify(todosOsResultados, null, 2),
              "utf-8"
            );
          } catch (e) {
            console.log(`  ⚠️  Erro ao guardar precos.json: ${e.message}`);
          }
        }

        await esperar(1200 + Math.random() * 1000);
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // Browser já encerrado
    }
  }

  const avisos = todosOsResultados.filter((r) => !r.confirmado).length;
  console.log(`\nConcluído. Total de ${todosOsResultados.length} produtos guardados em precos.json.`);
  if (avisos > 0) {
    console.log(`⚠️  ${avisos} produto(s) sem preço confirmado — revê o ficheiro.`);
  }
}

async function descobrirProdutos(browser, loja) {
  const encontrados = new Set();

  for (const categoriaBase of loja.categorias) {
    let pagina = 1;
    let continuar = true;

    while (continuar && pagina <= MAX_PAGINAS_POR_CATEGORIA) {
      const urlPagina =
        pagina === 1 ? categoriaBase : loja.urlPagina(categoriaBase, pagina);

      console.log(`  A ler categoria (página ${pagina}): ${urlPagina}`);

      let page;
      let linksNestaPagina = new Set();

      try {
        page = await browser.newPage();
        await configurarPagina(page);
        await page.goto(urlPagina, { waitUntil: "networkidle2", timeout: 35000 });
        await esperar(1000);

        const hrefs = await page.$$eval("a", (as) => as.map((a) => a.href));
        for (const href of hrefs) {
          if (loja.ehLinkDeProduto(href)) {
            linksNestaPagina.add(href.split("#")[0].split("?")[0]);
          }
        }
      } catch (erro) {
        console.log(`    Falhou ao carregar a página (${erro.message}) — a parar esta categoria.`);
        if (page) await page.close().catch(() => {});
        break;
      }

      if (page) await page.close().catch(() => {});

      let novosNestaPagina = 0;
      for (const link of linksNestaPagina) {
        if (!encontrados.has(link)) {
          encontrados.add(link);
          novosNestaPagina++;
        }
      }

      console.log(`    ${linksNestaPagina.size} link(s) de produto (${novosNestaPagina} novos).`);

      if (novosNestaPagina === 0) continuar = false;

      pagina++;
      await esperar(1200);
    }
  }

  return encontrados;
}

async function processarProduto(browser, url, nomeLoja) {
  console.log(`  A processar: ${url}`);

  let page;
  let html = "";
  let textoVisivel = "";
  let precoExtraidoDOM = null;

  try {
    page = await browser.newPage();
    await configurarPagina(page);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 35000 });

    try {
      await page.waitForFunction(
        () => document.body.innerText.includes("€"),
        { timeout: 6000 }
      );
    } catch {}

    // Extração robusta de preço: prioridade a dados estruturados JSON-LD e Meta Tags
    precoExtraidoDOM = await page.evaluate(() => {
      // 1. Tenta extrair via JSON-LD (ignora publicidade e prestações)
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.innerText);
          const items = Array.isArray(json) ? json : [json];
          
          for (const item of items) {
            if (item['@type'] === 'Product' || item['@type'] === 'http://schema.org/Product') {
              const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              if (offers && offers.price) {
                const p = parseFloat(offers.price);
                if (!isNaN(p) && p > 10) return p; // Descarta prestações irrisórias (<10€)
              }
            }
          }
        } catch (e) {}
      }

      // 2. Tenta extrair da meta tag oficial de preço
      const metaPrice = document.querySelector('meta[property="product:price:amount"], meta[itemprop="price"]');
      if (metaPrice) {
        const val = parseFloat(metaPrice.getAttribute("content"));
        if (!isNaN(val) && val > 10) return val;
      }

      // 3. Fallback no DOM excluindo seletores de financiamento/mensalidades
      const seletores = [
        "[data-price-type='finalPrice']",
        ".price",
        "[data-price]",
        ".price-new",
        ".current-price",
        ".product-price",
        ".pvp",
      ];

      for (const sel of seletores) {
        const elementos = document.querySelectorAll(sel);
        for (const el of elementos) {
          const textoPai = (el.parentElement ? el.parentElement.innerText : "").toLowerCase();
          const textoProprio = el.innerText.toLowerCase();

          // Ignora se estiver associado a modalidades de crédito ou mensalidades
          if (
            textoPai.includes("mês") || textoPai.includes("mes") || 
            textoPai.includes("klarna") || textoPai.includes("oney") ||
            textoPai.includes("prestação") || textoPai.includes("prestacao") ||
            textoProprio.includes("mês") || textoProprio.includes("mes")
          ) {
            continue;
          }

          const match = el.innerText.match(/(\d{1,3}(?:[.\s]\d{3})+[.,]\d{2}|\d+[.,]\d{2})/);
          if (match) {
            let clean = match[1];
            if ((clean.includes(".") || clean.includes(" ")) && clean.includes(",")) {
              clean = clean.replace(/[.\s]/g, "").replace(",", ".");
            } else if (clean.includes(",")) {
              clean = clean.replace(",", ".");
            }
            const num = parseFloat(clean);
            if (!isNaN(num) && num > 10) return num;
          }
        }
      }

      return null;
    });

    html = await page.content();
    textoVisivel = await page.evaluate(() => document.body.innerText);
  } catch (erro) {
    console.log(`    Falhou ao aceder à página (${erro.message}).`);
    if (page) await page.close().catch(() => {});
    return null;
  }

  if (page) await page.close().catch(() => {});

  const preco = precoExtraidoDOM !== null ? precoExtraidoDOM : extrairPreco(textoVisivel);
  const disponivel = extrairDisponibilidade(textoVisivel);
  const titulo = extrairTitulo(html);
  const ehGpu = /rtx|gtx|radeon|geforce|rx\s?\d{3,4}/i.test(titulo || "");

  if (!ehGpu) {
    console.log(`    ⚠️  Não parece ser uma GPU (título: "${titulo}") — ignorado.`);
    return null;
  }

  console.log(
    `    ${titulo} — ${preco !== null ? preco.toFixed(2) + "€" : "❌ Preço não encontrado"} — ${
      disponivel ? "Disponível" : "Indisponível"
    }`
  );

  return {
    nome: titulo,
    loja: nomeLoja,
    preco: preco,
    disponivel: disponivel,
    url: url,
    confirmado: preco !== null,
    atualizado_em: new Date().toISOString(),
  };
}

async function configurarPagina(page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8" });
  await page.setDefaultNavigationTimeout(35000);
}

function extrairPreco(texto) {
  if (!texto) return null;

  // Percorre todas as ocorrências de preço no texto e devolve o primeiro valor > 10€
  const matches = texto.matchAll(/(\d{1,3}(?:[.\s]\d{3})+[.,]\d{2}|\d+[.,]\d{2})\s*€/gi);

  for (const match of matches) {
    let valorStr = match[1];

    if ((valorStr.includes(".") || valorStr.includes(" ")) && valorStr.includes(",")) {
      valorStr = valorStr.replace(/[.\s]/g, "").replace(",", ".");
    } else if (valorStr.includes(",")) {
      valorStr = valorStr.replace(",", ".");
    }

    const precoFinal = parseFloat(valorStr);
    if (!isNaN(precoFinal) && precoFinal > 10) {
      return precoFinal;
    }
  }

  return null;
}

function extrairDisponibilidade(texto) {
  const lower = texto.toLowerCase();
  if (lower.includes("indisponível") || lower.includes("esgotado") || lower.includes("out of stock")) {
    return false;
  }
  return true;
}

function extrairTitulo(html) {
  const matchH1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (matchH1) return matchH1[1].replace(/<[^>]+>/g, "").trim();

  const matchTitle = html.match(/<title>([^<]+)<\/title>/i);
  if (matchTitle) return matchTitle[1].trim();

  return null;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();