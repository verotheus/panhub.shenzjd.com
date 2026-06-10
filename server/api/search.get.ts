import { defineEventHandler, getQuery, sendError, createError } from "h3";
import { requireSearchAuth } from "../utils/requireAuth";
import { getOrCreateSearchService } from "../core/services";
import { loggers } from "../core/utils/logger";
import { logSearchOnce } from "../utils/searchLog";
import type { GenericResponse, SearchRequest } from "../core/types/models";

function parseList(val: string | undefined): string[] | undefined {
  if (!val) return undefined;
  const parts = val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

export default defineEventHandler(async (event) => {
  requireSearchAuth(event);
  const config = useRuntimeConfig();
  const service = getOrCreateSearchService(config);
  const q = getQuery(event);

  const kw = ((q.kw as string) || "").trim();
  if (!kw) {
    return sendError(
      event,
      createError({ statusCode: 400, statusMessage: "kw is required" })
    );
  }

  let ext: Record<string, any> | undefined;
  const extStr = (q.ext as string | undefined)?.trim();
  if (extStr) {
    if (extStr === "{}") ext = {};
    else {
      try {
        ext = JSON.parse(extStr);
      } catch (e: any) {
        return sendError(
          event,
          createError({
            statusCode: 400,
            statusMessage: "invalid ext json: " + e?.message,
          })
        );
      }
    }
  }

  const req: SearchRequest = {
    kw,
    channels: parseList(q.channels as string | undefined),
    conc: q.conc ? parseInt(String(q.conc), 10) : undefined,
    refresh: String(q.refresh).trim() === "true",
    res: (q.res as any) || "merged_by_type",
    src: (q.src as any) || "all",
    plugins: parseList(q.plugins as string | undefined),
    cloud_types: parseList(q.cloud_types as string | undefined),
    ext,
  };

  if (req.src === "tg") req.plugins = undefined;
  else if (req.src === "plugin") req.channels = undefined;
  if (!req.res || req.res === "merge") req.res = "merged_by_type";

  const { response: result, warnings } = await service.searchWithWarnings(
    req.kw,
    req.channels,
    req.conc,
    !!req.refresh,
    req.res,
    req.src,
    req.plugins,
    req.cloud_types,
    req.ext || {}
  );

  logSearchOnce(kw, {
    src: req.src,
    channels: req.channels?.length || 0,
    plugins: req.plugins?.length || 0,
    results: result?.merged_by_type
      ? Object.values(result.merged_by_type).reduce((sum: number, v: any) => sum + (v.links?.length || 0), 0)
      : 0,
    warnings: warnings.length,
  });

  const resp: GenericResponse<typeof result> = {
    code: 0,
    message: warnings.length > 0 ? "partial_success" : "success",
    data: result,
  };

  if (warnings.length > 0) {
    (resp as any).warnings = warnings;
  }

  return resp;
});
