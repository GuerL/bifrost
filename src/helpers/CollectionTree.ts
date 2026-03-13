import type {
    CollectionLoaded,
    CollectionNode,
    CollectionRequestRefNode,
    Request,
} from "../types.ts";

export type SidebarFolderRow = {
    kind: "folder";
    nodeId: string;
    folderId: string;
    name: string;
    depth: number;
    parentFolderId: string | null;
    indexInParent: number;
    childCount: number;
};

export type SidebarRequestRow = {
    kind: "request";
    nodeId: string;
    requestId: string;
    request: Request | null;
    depth: number;
    parentFolderId: string | null;
    indexInParent: number;
};

export type SidebarTreeRow = SidebarFolderRow | SidebarRequestRow;

export type FolderOption = {
    folderId: string;
    label: string;
};

export function requestIdsInTreeOrder(items: CollectionNode[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();

    const visit = (nodes: CollectionNode[]) => {
        for (const node of nodes) {
            if (node.type === "request_ref") {
                if (seen.has(node.request_id)) continue;
                seen.add(node.request_id);
                out.push(node.request_id);
                continue;
            }
            visit(node.children);
        }
    };

    visit(items);
    return out;
}

export function requestsInTreeOrder(collection: CollectionLoaded): Request[] {
    const requestsById = new Map(collection.requests.map((request) => [request.id, request]));
    return requestIdsInTreeOrder(collection.meta.items)
        .map((requestId) => requestsById.get(requestId) ?? null)
        .filter((request): request is Request => request !== null);
}

export function countTreeRequestRefs(items: CollectionNode[]): number {
    return requestIdsInTreeOrder(items).length;
}

export function buildSidebarRows(
    items: CollectionNode[],
    requestsById: Map<string, Request>,
    expandedFolderIds: Set<string>
): SidebarTreeRow[] {
    const rows: SidebarTreeRow[] = [];

    const visit = (
        nodes: CollectionNode[],
        parentFolderId: string | null,
        depth: number
    ) => {
        nodes.forEach((node, indexInParent) => {
            if (node.type === "folder") {
                rows.push({
                    kind: "folder",
                    nodeId: node.id,
                    folderId: node.id,
                    name: node.name,
                    depth,
                    parentFolderId,
                    indexInParent,
                    childCount: node.children.length,
                });

                if (expandedFolderIds.has(node.id)) {
                    visit(node.children, node.id, depth + 1);
                }
                return;
            }

            rows.push({
                kind: "request",
                nodeId: node.request_id,
                requestId: node.request_id,
                request: requestsById.get(node.request_id) ?? null,
                depth,
                parentFolderId,
                indexInParent,
            });
        });
    };

    visit(items, null, 0);
    return rows;
}

export function folderOptions(items: CollectionNode[]): FolderOption[] {
    const options: FolderOption[] = [];

    const visit = (nodes: CollectionNode[], path: string[]) => {
        for (const node of nodes) {
            if (node.type !== "folder") continue;
            const nextPath = [...path, node.name];
            options.push({
                folderId: node.id,
                label: nextPath.join(" / "),
            });
            visit(node.children, nextPath);
        }
    };

    visit(items, []);
    return options;
}

export function containsRequestRef(items: CollectionNode[], requestId: string): boolean {
    return items.some((node) => {
        if (node.type === "request_ref") {
            return node.request_id === requestId;
        }
        return containsRequestRef(node.children, requestId);
    });
}

export function removeRequestRef(items: CollectionNode[], requestId: string): CollectionNode[] {
    return items
        .filter((node) => !(node.type === "request_ref" && node.request_id === requestId))
        .map((node) =>
            node.type === "folder"
                ? {
                      ...node,
                      children: removeRequestRef(node.children, requestId),
                  }
                : node
        );
}

export function insertRequestRefAtRoot(
    items: CollectionNode[],
    requestId: string
): CollectionNode[] {
    return [...items, requestRefNode(requestId)];
}

export function requestRefNode(requestId: string): CollectionRequestRefNode {
    return { type: "request_ref", request_id: requestId };
}
