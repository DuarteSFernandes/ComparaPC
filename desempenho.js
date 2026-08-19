/**
 * ComparaPC — Módulo de Cálculo de Desempenho e Custo-Benefício (Escala 0-100)
 */

const fs = require("fs");

const TABELA_DESEMPENHO = [
  // NVIDIA RTX 50 Series
  { modelo: "RTX 5090", regex: /rtx\s*5090/i, pontos: 230 },
  { modelo: "RTX 5080", regex: /rtx\s*5080/i, pontos: 175 },
  { modelo: "RTX 5070 Ti", regex: /rtx\s*5070\s*ti/i, pontos: 145 },
  { modelo: "RTX 5070", regex: /rtx\s*5070/i, pontos: 125 },
  { modelo: "RTX 5060 Ti", regex: /rtx\s*5060\s*ti/i, pontos: 95 },
  { modelo: "RTX 5060", regex: /rtx\s*5060/i, pontos: 78 },
  { modelo: "RTX 5050", regex: /rtx\s*5050/i, pontos: 52 },

  // NVIDIA RTX 40 Series
  { modelo: "RTX 4090", regex: /rtx\s*4090/i, pontos: 190 },
  { modelo: "RTX 4080 Super", regex: /rtx\s*4080\s*super/i, pontos: 155 },
  { modelo: "RTX 4080", regex: /rtx\s*4080/i, pontos: 150 },
  { modelo: "RTX 4070 Ti Super", regex: /rtx\s*4070\s*ti\s*super/i, pontos: 135 },
  { modelo: "RTX 4070 Ti", regex: /rtx\s*4070\s*ti/i, pontos: 125 },
  { modelo: "RTX 4070 Super", regex: /rtx\s*4070\s*super/i, pontos: 115 },
  { modelo: "RTX 4070", regex: /rtx\s*4070/i, pontos: 100 },
  { modelo: "RTX 4060 Ti", regex: /rtx\s*4060\s*ti/i, pontos: 78 },
  { modelo: "RTX 4060", regex: /rtx\s*4060/i, pontos: 62 },

  // NVIDIA RTX 30 Series & Legacy
  { modelo: "RTX 3060 Ti", regex: /rtx\s*3060\s*ti/i, pontos: 65 },
  { modelo: "RTX 3060", regex: /rtx\s*3060/i, pontos: 50 },
  { modelo: "GT 710", regex: /gt\s*710/i, pontos: 3 },

  // AMD Radeon RX 7000 Series
  { modelo: "RX 7900 XTX", regex: /rx\s*7900\s*xtx/i, pontos: 160 },
  { modelo: "RX 7900 XT", regex: /rx\s*7900\s*xt/i, pontos: 140 },
  { modelo: "RX 7900 GRE", regex: /rx\s*7900\s*gre/i, pontos: 120 },
  { modelo: "RX 7800 XT", regex: /rx\s*7800\s*xt/i, pontos: 105 },
  { modelo: "RX 7700 XT", regex: /rx\s*7700\s*xt/i, pontos: 88 },
  { modelo: "RX 7600 XT", regex: /rx\s*7600\s*xt/i, pontos: 62 },
  { modelo: "RX 7600", regex: /rx\s*7600/i, pontos: 55 },

  // AMD Radeon RX 6000 Series
  { modelo: "RX 6750 XT", regex: /rx\s*6750\s*xt/i, pontos: 82 },
  { modelo: "RX 6650 XT", regex: /rx\s*6650\s*xt/i, pontos: 60 },
  { modelo: "RX 6600", regex: /rx\s*6600/i, pontos: 50 },
];

function normalizarGPU(titulo) {
  if (!titulo) return null;

  for (const gpu of TABELA_DESEMPENHO) {
    if (gpu.regex.test(titulo)) {
      return {
        modelo_base: gpu.modelo,
        pontos_desempenho: gpu.pontos,
      };
    }
  }

  return null;
}

function processarDesempenho() {
  if (!fs.existsSync("precos.json")) {
    console.error("❌ Ficheiro precos.json não encontrado. Executa primeiro o scraper.js!");
    return;
  }

  console.log("A ler precos.json...");
  const produtos = JSON.parse(fs.readFileSync("precos.json", "utf-8"));
  
  // Teto máximo absoluto para a escala de performance (Top 100% = GPU mais forte da lista)
  const maxPontosAbsoluto = Math.max(...TABELA_DESEMPENHO.map((g) => g.pontos));

  const temporarios = [];

  for (const prod of produtos) {
    if (!prod.disponivel || !prod.preco || prod.preco <= 10) continue;

    const gpuInfo = normalizarGPU(prod.nome);
    if (gpuInfo) {
      const pontosPorEuro = gpuInfo.pontos_desempenho / prod.preco;
      temporarios.push({
        ...prod,
        gpu_modelo: gpuInfo.modelo_base,
        pontos_desempenho: gpuInfo.pontos_desempenho,
        pontosPorEuro,
      });
    }
  }

  if (temporarios.length === 0) {
    console.log("Nenhum produto válido para processar.");
    return;
  }

  // Teto máximo para a escala de Custo-Benefício
  const maxPontosPorEuro = Math.max(...temporarios.map((t) => t.pontosPorEuro));

  // Gera o objeto final com as métricas de 0 a 100
  const resultados = temporarios.map((item) => {
    const scoreDesempenho = Math.round((item.pontos_desempenho / maxPontosAbsoluto) * 100);
    const scoreCustoBeneficio = Math.round((item.pontosPorEuro / maxPontosPorEuro) * 100);
    const euroPorPonto = parseFloat((item.preco / item.pontos_desempenho).toFixed(2));

    return {
      nome: item.nome,
      loja: item.loja,
      preco: item.preco,
      disponivel: item.disponivel,
      url: item.url,
      atualizado_em: item.atualizado_em,
      gpu_modelo: item.gpu_modelo,
      score_desempenho: scoreDesempenho,       // 0 a 100 (Poder Bruto relativo à topo de gama)
      score_custo_beneficio: scoreCustoBeneficio, // 0 a 100 (Melhor investimento FPS por €)
      euro_por_ponto: euroPorPonto,             // Custo direto por ponto
    };
  });

  // Ordena por melhor score de custo-benefício (100 no topo)
  resultados.sort((a, b) => b.score_custo_beneficio - a.score_custo_beneficio);

  fs.writeFileSync("desempenho.json", JSON.stringify(resultados, null, 2), "utf-8");

  console.log(`\n✅ Processados ${resultados.length} produtos.`);
  console.log("Ficheiro 'desempenho.json' gerado com sucesso com escala 0-100!\n");

  console.log("=== TOP 5 MELHORES RÁCIOS (ESCORES 0-100) ===");
  resultados.slice(0, 5).forEach((item, i) => {
    console.log(
      `${i + 1}. [${item.loja}] ${item.gpu_modelo} — ${item.preco.toFixed(2)}€ | Desempenho: ${item.score_desempenho}/100 | Custo-Benefício: ${item.score_custo_beneficio}/100`
    );
  });
}

processarDesempenho();