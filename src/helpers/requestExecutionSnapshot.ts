import type { Request } from "../types.ts";

export type RequestExecutionCollectionLike = {
    requests: Request[];
};

export function resolveRequestForExecution(
    requestId: string,
    draftsById: Record<string, Request>,
    collection: RequestExecutionCollectionLike | null
): Request | null {
    const fromDraft = draftsById[requestId];
    if (fromDraft) return fromDraft;

    if (!collection) return null;
    return collection.requests.find((request) => request.id === requestId) ?? null;
}

export function applyDraftPatch(params: {
    requestId: string;
    draftsById: Record<string, Request>;
    fallbackRequest: Request;
    patch: Partial<Request>;
}): { nextDraftsById: Record<string, Request>; nextDraft: Request } {
    const baseRequest = params.draftsById[params.requestId] ?? params.fallbackRequest;
    const nextDraft = {
        ...baseRequest,
        ...params.patch,
    };

    return {
        nextDraft,
        nextDraftsById: {
            ...params.draftsById,
            [params.requestId]: nextDraft,
        },
    };
}

export function setFullDraftInMap(
    requestId: string,
    draftsById: Record<string, Request>,
    nextDraft: Request
): Record<string, Request> {
    return {
        ...draftsById,
        [requestId]: nextDraft,
    };
}
