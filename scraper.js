/**
 * ComparaPC — GPU Price Tracker & Scraper
 */

const fs = require("fs");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const STORES = [
  {
    name: "Depau",
    categories: ["https://www.depau.pt/componentes-hard-placas-graficas-c-11_21.html"],
    isProductLink: (href) => href.includes("depau.pt/") && href.includes("-p-"),
    pageUrl: (base, n) => `${base}?page=${n}`,
  },
  {
    name: "Chip7",
    categories: ["https://chip7.pt/componentes-hardware/placas-graficas"],
    isProductLink: (href) =>
      href.includes("chip7.pt/componentes-hardware/placas-graficas/") &&
      href.split("/").length >= 8,
    pageUrl: (base, n) => `${base}?page=${n}`,
  },
  {
    name: "PcDiga",
    categories: [
      "https://www.pcdiga.com/componentes/placas-graficas/placas-graficas-nvidia",
      "https://www.pcdiga.com/componentes/placas-graficas/placas-graficas-amd",
    ],
    isProductLink: (href) =>
      href.includes("pcdiga.com/") && href.includes("placa-grafica-"),
    pageUrl: (base, n) => `${base}?page=${n}`,
  },
  {
    name: "PcComponentes",
    categories: [
      "https://www.pccomponentes.pt/placas-graficas-nvidia",
      "https://www.pccomponentes.pt/placas-graficas-amd",
    ],
    isProductLink: (href) => {
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
    pageUrl: (base, n) => `${base}?page=${n}`,
  },
  {
    name: "Switch Technology",
    categories: [
      "https://switchtechnology.pt/produto-categoria/componentes/placas-graficas/",
    ],
    isProductLink: (href) => {
      const lower = href.toLowerCase();
      return (
        lower.includes("switchtechnology.pt/produto/") ||
        lower.includes("switchtechnology.pt/comprar/")
      );
    },
    pageUrl: (base, n) => `${base}page/${n}/`,
  },
  {
    name: "Globaldata",
    categories: [
      "https://www.globaldata.pt/componentes/placas-graficas/placas-graficas-nvidia",
      "https://www.globaldata.pt/componentes/placas-graficas/placas-graficas-amd",
    ],
    isProductLink: (href) => {
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
    pageUrl: (base, n) => `${base}?page=${n}`,
  },
];

const MAX_PAGES_PER_CATEGORY = 8;
const DATA_FILE = "prices.json";

// Helper to normalize model names for matching across stores
function normalizeGpuName(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("Starting browser...\n");
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

  let currentDataset = [];
  if (fs.existsSync(DATA_FILE)) {
    try {
      currentDataset = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      console.log(`Loaded ${currentDataset.length} existing entries from ${DATA_FILE}\n`);
    } catch {
      currentDataset = [];
    }
  }

  try {
    for (const store of STORES) {
      console.log(`\n=== Store: ${store.name} ===`);

      let productLinks;
      try {
        productLinks = await discoverProducts(browser, store);
      } catch (error) {
        console.log(` ⚠️ Failed to discover products for ${store.name} (${error.message}) — skipping.`);
        continue;
      }
      console.log(` ${productLinks.size} product link(s) found.`);

      for (const url of productLinks) {
        let result = null;
        try {
          result = await processProduct(browser, url, store.name);
        } catch (error) {
          console.log(` ⚠️ Error processing product (${error.message}) — skipping.`);
        }

        if (result && result.price) {
          saveOrUpdateGpu(currentDataset, result);
          
          try {
            fs.writeFileSync(
              DATA_FILE,
              JSON.stringify(currentDataset, null, 2),
              "utf-8"
            );
          } catch (e) {
            console.log(` ⚠️ Error saving ${DATA_FILE}: ${e.message}`);
          }
        }

        await delay(1200 + Math.random() * 1000);
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // Browser closed
    }
  }

  console.log(`\nExecution complete. Saved updated dataset to ${DATA_FILE}.`);
}

// Logic to merge new scraped prices into the existing JSON without losing other stores
function saveOrUpdateGpu(dataset, item) {
  const normTitle = normalizeGpuName(item.name);
  
  // Find GPU by matching normalized title
  let existingGpu = dataset.find(g => normalizeGpuName(g.model || g.name) === normTitle);

  const storeEntry = {
    name: item.store,
    price: item.price,
    url: item.url,
    available: item.available,
    updatedAt: item.updatedAt
  };

  if (existingGpu) {
    if (!existingGpu.stores) {
      existingGpu.stores = [];
    }
    
    // Check if store already exists for this model
    const storeIdx = existingGpu.stores.findIndex(s => s.name === item.store);
    if (storeIdx > -1) {
      existingGpu.stores[storeIdx] = storeEntry;
    } else {
      existingGpu.stores.push(storeEntry);
    }

    // Recalculate lowest price
    const validPrices = existingGpu.stores.filter(s => s.available && s.price > 0).map(s => s.price);
    existingGpu.lowestPrice = validPrices.length > 0 ? Math.min(...validPrices) : item.price;
  } else {
    // New entry
    dataset.push({
      model: item.name,
      lowestPrice: item.price,
      stores: [storeEntry]
    });
  }
}

async function discoverProducts(browser, store) {
  const found = new Set();

  for (const baseCategory of store.categories) {
    let pageNum = 1;
    let keepGoing = true;

    while (keepGoing && pageNum <= MAX_PAGES_PER_CATEGORY) {
      const pageUrl = pageNum === 1 ? baseCategory : store.pageUrl(baseCategory, pageNum);
      console.log(` Reading category page ${pageNum}: ${pageUrl}`);

      let page;
      let pageLinks = new Set();

      try {
        page = await browser.newPage();
        await setupPage(page);
        await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 35000 });
        await delay(1000);

        const hrefs = await page.$$eval("a", (as) => as.map((a) => a.href));
        for (const href of hrefs) {
          if (store.isProductLink(href)) {
            pageLinks.add(href.split("#")[0].split("?")[0]);
          }
        }
      } catch (error) {
        console.log(` Failed to load page (${error.message}) — skipping category.`);
        if (page) await page.close().catch(() => {});
        break;
      }

      if (page) await page.close().catch(() => {});

      let newOnPage = 0;
      for (const link of pageLinks) {
        if (!found.has(link)) {
          found.add(link);
          newOnPage++;
        }
      }

      console.log(` ${pageLinks.size} product link(s) found (${newOnPage} new).`);
      if (newOnPage === 0) keepGoing = false;

      pageNum++;
      await delay(1200);
    }
  }

  return found;
}

async function processProduct(browser, url, storeName) {
  console.log(` Processing: ${url}`);

  let page;
  let html = "";
  let visibleText = "";
  let domPrice = null;

  try {
    page = await browser.newPage();
    await setupPage(page);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 35000 });

    try {
      await page.waitForFunction(
        () => document.body.innerText.includes("€"),
        { timeout: 6000 }
      );
    } catch {}

    domPrice = await page.evaluate(() => {
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
                if (!isNaN(p) && p > 10) return p;
              }
            }
          }
        } catch (e) {}
      }

      const metaPrice = document.querySelector('meta[property="product:price:amount"], meta[itemprop="price"]');
      if (metaPrice) {
        const val = parseFloat(metaPrice.getAttribute("content"));
        if (!isNaN(val) && val > 10) return val;
      }

      const selectors = [
        "[data-price-type='finalPrice']",
        ".price",
        "[data-price]",
        ".price-new",
        ".current-price",
        ".product-price",
        ".pvp",
      ];

      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          const parentText = (el.parentElement ? el.parentElement.innerText : "").toLowerCase();
          const selfText = el.innerText.toLowerCase();

          if (
            parentText.includes("mês") || parentText.includes("mes") || 
            parentText.includes("klarna") || parentText.includes("oney") ||
            parentText.includes("prestação") || parentText.includes("prestacao") ||
            selfText.includes("mês") || selfText.includes("mes")
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
    visibleText = await page.evaluate(() => document.body.innerText);
  } catch (error) {
    console.log(` Failed to access page (${error.message}).`);
    if (page) await page.close().catch(() => {});
    return null;
  }

  if (page) await page.close().catch(() => {});

  const price = domPrice !== null ? domPrice : extractPrice(visibleText);
  const available = extractAvailability(visibleText);
  const title = extractTitle(html);
  
  // Filter current generation GPUs
  const isRecentGpu = /rtx\s*(30|40)\d{2}|rx\s*(6|7)\d{3}|arc\s*a\d{3}/i.test(title || "");

  if (!isRecentGpu) {
    console.log(` ⚠️ Not a target current-gen GPU ("${title}") — skipped.`);
    return null;
  }

  console.log(
    ` ${title} — ${price !== null ? price.toFixed(2) + "€" : "❌ Price not found"} — ${
      available ? "Available" : "Out of stock"
    }`
  );

  return {
    name: title,
    store: storeName,
    price: price,
    available: available,
    url: url,
    updatedAt: new Date().toISOString(),
  };
}

async function setupPage(page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8" });
  await page.setDefaultNavigationTimeout(35000);
}

function extractPrice(text) {
  if (!text) return null;

  const matches = text.matchAll(/(\d{1,3}(?:[.\s]\d{3})+[.,]\d{2}|\d+[.,]\d{2})\s*€/gi);

  for (const match of matches) {
    let valStr = match[1];

    if ((valStr.includes(".") || valStr.includes(" ")) && valStr.includes(",")) {
      valStr = valStr.replace(/[.\s]/g, "").replace(",", ".");
    } else if (valStr.includes(",")) {
      valStr = valStr.replace(",", ".");
    }

    const finalPrice = parseFloat(valStr);
    if (!isNaN(finalPrice) && finalPrice > 10) {
      return finalPrice;
    }
  }

  return null;
}

function extractAvailability(text) {
  const lower = text.toLowerCase();
  if (lower.includes("indisponível") || lower.includes("esgotado") || lower.includes("out of stock")) {
    return false;
  }
  return true;
}

function extractTitle(html) {
  const matchH1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (matchH1) return matchH1[1].replace(/<[^>]+>/g, "").trim();

  const matchTitle = html.match(/<title>([^<]+)<\/title>/i);
  if (matchTitle) return matchTitle[1].trim();

  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();