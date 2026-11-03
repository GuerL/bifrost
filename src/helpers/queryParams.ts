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

function encodeQueryComponent(value: string): string {
    return new URLSearchParams([["", value]]).toString().slice(1);
}

// Templates belong to the editor language; encode only the surrounding URL data.
function encodeEditableComponent(value: string): string {
    return value.split(/({{[^{}]*}})/g).map((part, index) =>
        index % 2 === 1 ? part : encodeQueryComponent(part)
    ).join("");
}

export function serializeQueryParams(query: KeyValue[]): string {
    return enabledQueryParams(query).map((entry) =>
        `${encodeEditableComponent(entry.key)}=${encodeEditableComponent(entry.value)}`
    ).join("&");
}

// Reconcile legacy/base-only saved URLs without rewriting equivalent raw input.
export function synchronizeEditableUrl(url: string, query: KeyValue[]): string {
    const parsed = parseQueryString(splitUrlQuery(url).query);
    const active = query.filter((entry) => entry.enabled !== false);
    if (parsed.length === active.length && parsed.every((entry, index) =>
        entry.key === active[index].key && entry.value === active[index].value
    )) return url;
    return buildUrlWithQueryParams(url, query);
}

// Reuse the caller's resolver on decoded components, then encode exactly once.
export function resolveExecutableUrl(request: Request, resolve: (text: string) => string): string {
    const { beforeQuery, hash } = splitUrlQuery(request.url);
    const params = new URLSearchParams();
    const query = request.query.length ? request.query : parseQueryString(splitUrlQuery(request.url).query);
    for (const entry of enabledQueryParams([...query, ...authQueryParam(request.auth)])) {
        params.append(resolve(entry.key), resolve(entry.value));
    }
    const serialized = params.toString();
    return `${resolve(beforeQuery)}${serialized ? `?${serialized}` : ""}${resolve(hash)}`;
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
