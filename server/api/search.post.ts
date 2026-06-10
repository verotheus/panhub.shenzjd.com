import { defineEventHandler, readBody, sendError, createError } from "h3";
import { requireSearchAuth } from "../utils/requireAuth";
import { getOrCreateSearchService } from "../core/services";
import { logSearchOnce } from "../utils/searchLog";
import type { GenericResponse, SearchRequest } from "../core/types/models";

export default defineEventHandler(async (event) => {
  requireSearchAuth(event);
  const config = useRuntimeConfig();
  const service = getOrCreateSearchService(config);
  const body = (await readBody<SearchRequest>(event)) || ({} as SearchRequest);

  const kw = (body.kw || "").trim();
  if (!kw) {
    return sendError(
      event,
      createError({ statusCode: 400, statusMessage: "kw is required" })
    );
  }

  const parseList = (val: any): string[] | undefined => {
    if (Array.isArray(val)) {
      return val.filter((s) => typeof s === "string" && s.trim());
    }
    if (typeof val === "string") {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return undefined;
  };

  body.channels = parseList((body as any).channels);
  body.plugins = parseList((body as any).plugins);
  body.cloud_types = parseList((body as any).cloud_types);

  if (!body.res || body.res === "merge") body.res = "merged_by_type";
  if (!body.src) body.src = "all";
  if (body.src === "tg") body.plugins = undefined;
  else if (body.src === "plugin") body.channels = undefined;

  const { response: result, warnings } = await service.searchWithWarnings(
    kw,
    body.channels,
    body.conc,
    !!body.refresh,
    body.res,
    body.src,
    body.plugins,
    body.cloud_types,
    body.ext || {}
  );

  logSearchOnce(kw, {
    src: body.src,
    channels: body.channels?.length || 0,
    plugins: body.plugins?.length || 0,
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
