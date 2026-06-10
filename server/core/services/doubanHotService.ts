import { load } from "cheerio";
import { ofetch } from "ofetch";
import { DOUBAN_HOT_SOURCES } from "../../../config/doubanHot";
import { MemoryCache } from "../cache/memoryCache";

export interface DoubanHotItem {
  id?: number;
  title: string;
  url?: string;
  cover?: string;
  desc?: string;
  hot?: number;
}

export interface DoubanHotCategory {
  id: string;
  label: string;
  title: string;
  type: string;
  items: DoubanHotItem[];
}

export interface DoubanHotResult {
  categories: Record<string, DoubanHotCategory>;
}

export interface DoubanHotPageResult {
  items: DoubanHotItem[];
  hasMore: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时（豆瓣榜单更新较慢，一天更新一次即可）
const cache = new MemoryCache<DoubanHotResult>({ maxSize: 10 });
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";

function getNumbers(text: string | undefined): number {
  if (!text) return 0;
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function buildCacheKey(categories: string[]): string {
  return `douban-hot:${[...categories].sort().join(",")}`;
}

/** 豆瓣 CDN 实际返回 webp，页面里的 .jpg 需替换为 .webp */
function fixDoubanCoverUrl(url: string): string {
  if (!url || !url.includes("doubanio.com")) return url;
  return url.replace(/\.jpg$/i, ".webp");
}

export function extractSearchTerm(title: string): string {
  return title.replace(/^【[\d.]+】/, "").trim() || title;
}

async function scrapeDoubanMovie(): Promise<DoubanHotItem[]> {
  const url = "https://movie.douban.com/chart/";
  const html = await ofetch<string>(url, {
    headers: { "user-agent": UA },
    timeout: 10000,
  });
  const $ = load(html);
  const items: DoubanHotItem[] = [];

  $(".article tr.item").each((_, el) => {
    const dom = $(el);
    const href = dom.find("a").attr("href") || "";
    const id = getNumbers(href);
    const rawTitle = dom.find("a").attr("title") || "";
    const scoreDom = dom.find(".rating_nums");
    const score = scoreDom.length ? scoreDom.text() : "0.0";
    const title = rawTitle ? `【${score}】${rawTitle}` : "";
    if (!title) return;

    const img = dom.find("img");
    const cover =
      img.attr("data-src") ||
      img.attr("data-original") ||
      img.attr("src") ||
      undefined;

    const coverUrl = cover
      ? fixDoubanCoverUrl(cover.startsWith("//") ? "https:" + cover : cover)
      : undefined;
    items.push({
      id: id || undefined,
      title,
      cover: coverUrl,
      desc: dom.find("p.pl").text().trim(),
      hot: getNumbers(dom.find("span.pl").text()),
      url: href || `https://movie.douban.com/subject/${id}/`,
    });
  });

  return items;
}

async function scrapeDoubanTop250(): Promise<DoubanHotItem[]> {
  const allItems: DoubanHotItem[] = [];
  const totalPages = 10; // Top250 共10页，每页25个
  const PAGE_DELAY = 1500; // 页间延迟(ms)，避免被豆瓣限流

  for (let page = 0; page < totalPages; page++) {
    const start = page * 25;
    const url = start === 0
      ? "https://movie.douban.com/top250"
      : `https://movie.douban.com/top250?start=${start}`;

    try {
      const html = await ofetch<string>(url, {
        headers: { "user-agent": UA },
        timeout: 10000,
      });
      const $ = load(html);

      $(".article ol.grid_view li").each((_, el) => {
        const dom = $(el);
        const href = dom.find(".pic a").attr("href") || "";
        const id = getNumbers(href);
        const rawTitle = dom.find(".info .title").first().text() || "";
        const scoreDom = dom.find(".info .rating_num");
        const score = scoreDom.length ? scoreDom.text() : "0.0";
        const title = rawTitle ? `【${score}】${rawTitle}` : "";
        if (!title) return;

        const img = dom.find("img");
        const cover =
          img.attr("data-src") ||
          img.attr("data-original") ||
          img.attr("src") ||
          undefined;

        const coverUrl = cover
          ? fixDoubanCoverUrl(cover.startsWith("//") ? "https:" + cover : cover)
          : undefined;

        const quote = dom.find(".info .inq").text().trim();
        const info = dom.find(".info .bd p").first().text().trim();

        allItems.push({
          id: id || undefined,
          title,
          cover: coverUrl,
          desc: quote || info.split("/")[0].trim(),
          hot: getNumbers(dom.find(".info .star span:last").text()),
          url: href || `https://movie.douban.com/subject/${id}/`,
        });
      });

      // 页间延迟避免被限流
      if (page < totalPages - 1) {
        await new Promise(resolve => setTimeout(resolve, PAGE_DELAY));
      }
    } catch (e) {
      console.warn(`[DoubanTop250] 第 ${page + 1} 页抓取失败:`, (e as Error).message);
      // 连续失败2页则放弃后续抓取，避免无意义请求
      if (page >= 1 && allItems.length === 0) {
        console.warn(`[DoubanTop250] 前 ${page + 1} 页均无数据，终止抓取`);
        break;
      }
    }
  }

  return allItems;
}

/** 从电影详情页获取封面图片 */
async function fetchMovieCover(id: number): Promise<string | undefined> {
  try {
    // 使用移动版页面获取图片，更稳定
    const url = `https://m.douban.com/movie/subject/${id}/`;
    const html = await ofetch<string>(url, {
      headers: { "user-agent": UA },
      timeout: 5000,
    });
    const $ = load(html);
    // 移动版页面的图片选择器
    const img = $("img[src*='view/photo'], img[src*='s_ratio_poster']").first();
    const cover = img.attr("src") || undefined;
    if (cover) {
      return fixDoubanCoverUrl(cover.startsWith("//") ? "https:" + cover : cover);
    }
  } catch {
    // 忽略错误，返回 undefined
  }
  return undefined;
}

/** 批量获取电影封面（并发限制） */
async function fetchMovieCovers(ids: number[]): Promise<Map<number, string>> {
  const coverMap = new Map<number, string>();
  const batchSize = 3; // 并发限制，避免请求过快

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (id) => {
        const cover = await fetchMovieCover(id);
        return { id, cover };
      })
    );
    for (const { id, cover } of results) {
      if (cover) coverMap.set(id, cover);
    }
    // 短暂延迟避免请求过快
    if (i + batchSize < ids.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return coverMap;
}

async function scrapeDoubanWeekly(): Promise<DoubanHotItem[]> {
  const url = "https://movie.douban.com/chart/";
  const html = await ofetch<string>(url, {
    headers: { "user-agent": UA },
    timeout: 10000,
  });
  const $ = load(html);
  const items: DoubanHotItem[] = [];
  const idsWithoutCover: number[] = [];

  // 找到包含"一周口碑榜"的 h2，然后获取其父元素中的列表
  $("h2").each((_, h2) => {
    const h2Text = $(h2).text();
    if (h2Text.includes("一周口碑榜")) {
      // 获取 h2 后面的列表
      const list = $(h2).next("ul");
      if (list.length) {
        list.find("li").each((_, el) => {
          const dom = $(el);
          const rank = dom.find(".no").text().trim();
          const href = dom.find(".name a").attr("href") || "";
          const id = getNumbers(href);
          const rawTitle = dom.find(".name a").text().trim();
          const title = rawTitle ? `#${rank} ${rawTitle}` : "";
          if (!title) return;

          const scoreDom = dom.find(".rating_nums");
          const score = scoreDom.length ? scoreDom.text().trim() : "";
          const desc = score ? `评分 ${score}` : "";

          items.push({
            id: id || undefined,
            title,
            desc,
            url: href || `https://movie.douban.com/subject/${id}/`,
          });
          if (id) idsWithoutCover.push(id);
        });
      }
    }
  });

  // 批量获取封面
  if (idsWithoutCover.length > 0) {
    const coverMap = await fetchMovieCovers(idsWithoutCover);
    for (const item of items) {
      if (item.id && coverMap.has(item.id)) {
        item.cover = coverMap.get(item.id);
      }
    }
  }

  return items;
}

async function scrapeDoubanUsBox(): Promise<DoubanHotItem[]> {
  const url = "https://movie.douban.com/chart/";
  const html = await ofetch<string>(url, {
    headers: { "user-agent": UA },
    timeout: 10000,
  });
  const $ = load(html);
  const items: DoubanHotItem[] = [];
  const idsWithoutCover: number[] = [];

  // 找到包含"北美票房榜"的 h2，然后获取其父元素中的列表
  $("h2").each((_, h2) => {
    const h2Text = $(h2).text();
    if (h2Text.includes("北美票房榜")) {
      // 获取 h2 后面的列表
      const list = $(h2).next("ul");
      if (list.length) {
        list.find("li").each((_, el) => {
          const dom = $(el);
          const rank = dom.find(".no").text().trim();
          const href = dom.find(".box_chart a").attr("href") || "";
          const id = getNumbers(href);
          const rawTitle = dom.find(".box_chart a").text().trim();
          const title = rawTitle ? `#${rank} ${rawTitle}` : "";
          if (!title) return;

          const boxOffice = dom.find(".box_office").text().trim();
          const desc = boxOffice ? `票房 ${boxOffice}` : "";

          const img = dom.find("img");
          let coverUrl: string | undefined = undefined;

          // 检查是否有图片
          if (img.length > 0) {
            const rawCover =
              img.attr("data-src") ||
              img.attr("data-original") ||
              img.attr("src") ||
              "";

            // 过滤掉标记图标（box_new.png 等非电影封面）
            const isIconMarker = rawCover.includes("box_new.png") ||
                               rawCover.includes("box_hot.png") ||
                               rawCover.includes("/pics/box_") ||
                               rawCover.includes("/f/vendors/");

            if (!isIconMarker && rawCover) {
              coverUrl = fixDoubanCoverUrl(rawCover.startsWith("//") ? "https:" + rawCover : rawCover);
            }
          }

          items.push({
            id: id || undefined,
            title,
            cover: coverUrl,
            desc,
            url: href || `https://movie.douban.com/subject/${id}/`,
          });
          // 如果没有真实封面，记录ID以便批量获取
          if (!coverUrl && id) {
            idsWithoutCover.push(id);
          }
        });
      }
    }
  });

  // 批量获取封面
  if (idsWithoutCover.length > 0) {
    const coverMap = await fetchMovieCovers(idsWithoutCover);
    for (const item of items) {
      if (item.id && !item.cover && coverMap.has(item.id)) {
        item.cover = coverMap.get(item.id);
      }
    }
  }

  return items;
}

async function scrapeDoubanTvHot(): Promise<DoubanHotItem[]> {
  // 使用豆瓣选影视页面获取电视剧数据
  const url = "https://movie.douban.com/tv/";
  const html = await ofetch<string>(url, {
    headers: { "user-agent": UA },
    timeout: 10000,
  });
  const $ = load(html);
  const items: DoubanHotItem[] = [];

  // 尝试多种选择器模式
  const selectors = [
    ".article tr.item",
    ".list-col li.list-item",
    ".grid_view .item",
    "table tr.item",
    ".widget-content li"
  ];

  for (const selector of selectors) {
    const found = $(selector);
    if (found.length > 0) {
      found.each((_, el) => {
        const dom = $(el);
        const href = dom.find("a").attr("href") || dom.attr("href") || "";
        const id = getNumbers(href);

        // 尝试多种标题获取方式
        let rawTitle = dom.find("a").attr("title") ||
                       dom.find(".title a").text() ||
                       dom.find("a").first().text() || "";
        rawTitle = rawTitle.trim();

        const scoreDom = dom.find(".rating_nums");
        const score = scoreDom.length ? scoreDom.text() : dom.find(".star .rating_num").text() || "0.0";
        const title = rawTitle ? `【${score}】${rawTitle}` : "";
        if (!title || !rawTitle) return;

        const img = dom.find("img");
        const cover =
          img.attr("data-src") ||
          img.attr("data-original") ||
          img.attr("src") ||
          undefined;

        const coverUrl = cover
          ? fixDoubanCoverUrl(cover.startsWith("//") ? "https:" + cover : cover)
          : undefined;

        items.push({
          id: id || undefined,
          title,
          cover: coverUrl,
          desc: dom.find("p.pl, .abstract").text().trim() || "",
          hot: getNumbers(dom.find("span.pl").text()),
          url: href || `https://movie.douban.com/subject/${id}/`,
        });
      });

      if (items.length > 0) break;
    }
  }

  return items;
}

async function scrapeDoubanTvWeekly(): Promise<DoubanHotItem[]> {
  const url = "https://movie.douban.com/tv/";
  const html = await ofetch<string>(url, {
    headers: { "user-agent": UA },
    timeout: 10000,
  });
  const $ = load(html);
  const items: DoubanHotItem[] = [];
  const idsWithoutCover: number[] = [];

  // 查找口碑榜相关的列表
  const口碑Selectors = [
    "h2:contains('口碑') + ul li",
    ".ranking li",
    ".top10 li",
    ".weekly-list li",
    "[class*='weekly'] li",
    "[class*='ranking'] li"
  ];

  for (const selector of 口碑Selectors) {
    const list = $(selector);
    if (list.length > 0) {
      list.each((_, el) => {
        const dom = $(el);
        const rank = dom.find(".no, .rank").text().trim() || String(items.length + 1);
        const href = dom.find("a").attr("href") || dom.attr("data-href") || "";
        const id = getNumbers(href);
        const rawTitle = dom.find("a").text().trim() || dom.find(".title").text().trim();
        const title = rawTitle ? `#${rank} ${rawTitle}` : "";
        if (!title) return;

        const scoreDom = dom.find(".rating_nums, .rating_num");
        const score = scoreDom.length ? scoreDom.text().trim() : "";
        const desc = score ? `评分 ${score}` : "";

        items.push({
          id: id || undefined,
          title,
          desc,
          url: href || `https://movie.douban.com/subject/${id}/`,
        });
        if (id) idsWithoutCover.push(id);
      });

      if (items.length > 0) break;
    }
  }

  // 批量获取封面
  if (idsWithoutCover.length > 0 && items.length > 0) {
    try {
      const coverMap = await fetchMovieCovers(idsWithoutCover);
      for (const item of items) {
        if (item.id && coverMap.has(item.id)) {
          item.cover = coverMap.get(item.id);
        }
      }
    } catch (e) {
      // 忽略封面获取失败
    }
  }

  return items;
}

async function scrapeDoubanVarietyHot(): Promise<DoubanHotItem[]> {
  // 尝试多个综艺页面
  const urls = [
    "https://movie.douban.com/tv/?style=variety",
    "https://movie.douban.com/chart",
    "https://movie.douban.com/explore"
  ];

  for (const url of urls) {
    try {
      const html = await ofetch<string>(url, {
        headers: { "user-agent": UA },
        timeout: 10000,
      });
      const $ = load(html);
      const items: DoubanHotItem[] = [];

      // 尝试多种选择器
      const selectors = [
        ".article tr.item",
        ".list-col li.list-item",
        ".grid_view .item",
        "table tr.item",
        ".widget-content li",
        "[class*='variety'] li"
      ];

      for (const selector of selectors) {
        const found = $(selector);
        if (found.length > 0) {
          found.each((_, el) => {
            const dom = $(el);
            const href = dom.find("a").attr("href") || dom.attr("href") || "";
            const id = getNumbers(href);

            // 过滤：只选择综艺（通过标题或描述判断）
            const descText = dom.find("p.pl, .abstract").text().toLowerCase();
            const rawTitle = dom.find("a").attr("title") ||
                           dom.find(".title a").text() ||
                           dom.find("a").first().text() || "";
            const trimmedTitle = rawTitle.trim();

            // 简单过滤：检查是否包含综艺关键词
            const varietyKeywords = ["综艺", "秀", "真人秀", "脱口秀", "选秀", "竞技", "节目"];
            const isVariety = varietyKeywords.some(kw =>
              trimmedTitle.includes(kw) || descText.includes(kw)
            );

            if (!trimmedTitle || (!isVariety && selector.includes("variety"))) return;

            const scoreDom = dom.find(".rating_nums");
            const score = scoreDom.length ? scoreDom.text() : dom.find(".star .rating_num").text() || "0.0";
            const title = `【${score}】${trimmedTitle}`;

            const img = dom.find("img");
            const cover =
              img.attr("data-src") ||
              img.attr("data-original") ||
              img.attr("src") ||
              undefined;

            const coverUrl = cover
              ? fixDoubanCoverUrl(cover.startsWith("//") ? "https:" + cover : cover)
              : undefined;

            items.push({
              id: id || undefined,
              title,
              cover: coverUrl,
              desc: dom.find("p.pl, .abstract").text().trim() || "",
              hot: getNumbers(dom.find("span.pl").text()),
              url: href || `https://movie.douban.com/subject/${id}/`,
            });
          });

          if (items.length > 0) {
            return items.slice(0, 25); // 返回前25个
          }
        }
      }
    } catch (e) {
      console.warn(`[DoubanHot] 获取综艺数据失败 (${url}):`, (e as Error).message);
      continue;
    }
  }

  return [];
}

async function scrapeDoubanVarietyWeekly(): Promise<DoubanHotItem[]> {
  const urls = [
    "https://movie.douban.com/tv/?style=variety",
    "https://movie.douban.com/chart"
  ];

  for (const url of urls) {
    try {
      const html = await ofetch<string>(url, {
        headers: { "user-agent": UA },
        timeout: 10000,
      });
      const $ = load(html);
      const items: DoubanHotItem[] = [];
      const idsWithoutCover: number[] = [];

      // 查找口碑榜相关的列表
      const口碑Selectors = [
        "h2:contains('口碑') + ul li",
        ".ranking li",
        ".top10 li",
        ".weekly-list li",
        "[class*='weekly'] li",
        "[class*='ranking'] li"
      ];

      for (const selector of 口碑Selectors) {
        const list = $(selector);
        if (list.length > 0) {
          list.each((_, el) => {
            const dom = $(el);
            const rank = dom.find(".no, .rank").text().trim() || String(items.length + 1);
            const href = dom.find("a").attr("href") || dom.attr("data-href") || "";
            const id = getNumbers(href);
            const rawTitle = dom.find("a").text().trim() || dom.find(".title").text().trim();

            // 简单过滤：检查是否包含综艺关键词
            const varietyKeywords = ["综艺", "秀", "真人秀", "脱口秀", "选秀", "竞技", "节目"];
            const isVariety = varietyKeywords.some(kw => rawTitle.includes(kw));

            if (!rawTitle || !isVariety) return;

            const title = `#${rank} ${rawTitle}`;

            const scoreDom = dom.find(".rating_nums, .rating_num");
            const score = scoreDom.length ? scoreDom.text().trim() : "";
            const desc = score ? `评分 ${score}` : "";

            items.push({
              id: id || undefined,
              title,
              desc,
              url: href || `https://movie.douban.com/subject/${id}/`,
            });
            if (id) idsWithoutCover.push(id);
          });

          if (items.length > 0) {
            // 批量获取封面
            if (idsWithoutCover.length > 0) {
              try {
                const coverMap = await fetchMovieCovers(idsWithoutCover);
                for (const item of items) {
                  if (item.id && coverMap.has(item.id)) {
                    item.cover = coverMap.get(item.id);
                  }
                }
              } catch (e) {
                // 忽略封面获取失败
              }
            }
            return items.slice(0, 25);
          }
        }
      }
    } catch (e) {
      console.warn(`[DoubanHot] 获取综艺口碑榜失败 (${url}):`, (e as Error).message);
      continue;
    }
  }

  return [];
}

const scrapers: Record<string, () => Promise<DoubanHotItem[]>> = {
  "douban-movie": scrapeDoubanMovie,
  "douban-top250": scrapeDoubanTop250,
  "douban-weekly": scrapeDoubanWeekly,
  "douban-us-box": scrapeDoubanUsBox,
};

// 按分类分页获取数据（全量数据缓存，分页仅做切片）
const allItemsCache = new MemoryCache<DoubanHotItem[]>({ maxSize: 20 });

async function fetchAllItems(category: string): Promise<DoubanHotItem[]> {
  const cacheKey = `douban-hot:${category}:all`;
  const cached = allItemsCache.get(cacheKey);
  if (cached.hit && cached.value) {
    return cached.value;
  }

  const scrape = scrapers[category];
  if (!scrape) return [];

  const allItems = await scrape();
  allItemsCache.set(cacheKey, allItems, CACHE_TTL_MS);
  return allItems;
}

export async function fetchDoubanHotByCategory(
  category: string,
  page: number = 1,
  limit: number = 25
): Promise<DoubanHotPageResult> {
  const allItems = await fetchAllItems(category);

  const start = (page - 1) * limit;
  const end = start + limit;
  const items = allItems.slice(start, end);
  const hasMore = end < allItems.length;

  return { items, hasMore };
}

export async function fetchDoubanHot(
  categories?: string[]
): Promise<DoubanHotResult> {
  const routeIds = categories?.length
    ? categories
    : DOUBAN_HOT_SOURCES.map((s) => s.route);
  const cacheKey = buildCacheKey(routeIds);

  const cached = cache.get(cacheKey);
  if (cached.hit && cached.value) {
    return cached.value;
  }

  const results: DoubanHotResult = { categories: {} };

  await Promise.all(
    routeIds.map(async (route) => {
      const config = DOUBAN_HOT_SOURCES.find((s) => s.route === route);
      if (!config) return;

      const scrape = scrapers[route];
      if (!scrape) {
        results.categories[config.id] = {
          id: config.id,
          label: config.label,
          title: config.label,
          type: "",
          items: [],
        };
        return;
      }

      try {
        const items = await scrape();
        results.categories[config.id] = {
          id: config.id,
          label: config.label,
          title: config.label,
          type: config.type || "",
          items,
        };
      } catch (e) {
        results.categories[config.id] = {
          id: config.id,
          label: config.label,
          title: config.label,
          type: "",
          items: [],
        };
        console.warn(`[DoubanHot] ${route} 抓取失败:`, (e as Error).message);
      }
    })
  );

  cache.set(cacheKey, results, CACHE_TTL_MS);
  return results;
}
