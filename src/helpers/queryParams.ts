import type { KeyValue, Request, RequestAuth } from "../types.ts";

export type UrlParts = {
    beforeQuery: string;
    query: string;
    hash: string;
};

export function splitUrlQuery(url: string): UrlParts {
    const hashIndex = url.indexOf("#");
    const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
    const queryIndex = beforeHash.indexOf("?");

    if (queryIndex < 0) {
        return {
            beforeQuery: beforeHash,
            query: "",
            hash,
        };
    }

    return {
        beforeQuery: beforeHash.slice(0, queryIndex),
        query: beforeHash.slice(queryIndex + 1),
        hash,
    };
}

export function parseQueryString(query: string): KeyValue[] {
    const input = query.startsWith("?") ? query.slice(1) : query;
    if (!input) return [];

    const params = new URLSearchParams(input);
    const rows: KeyValue[] = [];
    params.forEach((value, key) => {
        rows.push({ key, value, enabled: true });
    });
    return rows;
}

export function enabledQueryParams(query: KeyValue[]): KeyValue[] {
    return query.filter((entry) => entry.enabled !== false && entry.key.trim().length > 0);
}

export function serializeQueryParams(query: KeyValue[]): string {
    const params = new URLSearchParams();
    for (const entry of enabledQueryParams(query)) {
        params.append(entry.key, entry.value);
    }
    return params.toString();
}

export function buildUrlWithQueryParams(url: string, query: KeyValue[]): string {
    const { beforeQuery, hash } = splitUrlQuery(url);
    const serialized = serializeQueryParams(query);
    return `${beforeQuery}${serialized ? `?${serialized}` : ""}${hash}`;
}

export function reconcileUrlQueryWithParams(previousParams: KeyValue[], nextUrl: string): KeyValue[] {
    const parsedParams = parseQueryString(splitUrlQuery(nextUrl).query);
    const nextParams: KeyValue[] = [];
    let parsedIndex = 0;

    for (const previousParam of previousParams) {
        if (previousParam.enabled === false) {
            nextParams.push(previousParam);
            continue;
        }

        if (parsedIndex >= parsedParams.length) {
            continue;
        }

        nextParams.push(parsedParams[parsedIndex]);
        parsedIndex += 1;
    }

    while (parsedIndex < parsedParams.length) {
        nextParams.push(parsedParams[parsedIndex]);
        parsedIndex += 1;
    }

    return nextParams;
}

function authQueryParam(auth: RequestAuth): KeyValue[] {
    if (auth.type !== "api_key" || auth.in !== "query") return [];
    if (auth.key.trim().length === 0) return [];
    return [{ key: auth.key.trim(), value: auth.value, enabled: true }];
}

export function effectiveRequestUrl(request: Request): string {
    return buildUrlWithQueryParams(request.url, [
        ...request.query,
        ...authQueryParam(request.auth),
    ]);
}
