import { monitoredEntitiesClient } from "@dynatrace-sdk/client-classic-environment-v2";

/** Get the total count of entities for a given type */
export async function getEntityCount(entityType: string): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const response = await monitoredEntitiesClient.getEntities({
      entitySelector: `type("${entityType}")`,
      pageSize: 1,
    });
    return response.totalCount ?? 0;
  } catch {
    return 0;
  }
}

/** Get entities of a given type with basic fields */
export async function getEntities(
  entityType: string,
  fields?: string,
  maxPages = 3
): Promise<unknown[]> {
  const allItems: unknown[] = [];
  let nextPageKey: string | undefined;
  let page = 0;

  do {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const response = await monitoredEntitiesClient.getEntities({
      entitySelector: `type("${entityType}")`,
      fields: fields ?? "+properties",
      pageSize: 500,
      nextPageKey,
    });
    if (response.entities) {
      allItems.push(...response.entities);
    }
    nextPageKey = response.nextPageKey;
    page++;
  } while (nextPageKey && page < maxPages);

  return allItems;
}
