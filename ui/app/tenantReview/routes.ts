export const TENANT_REVIEW_BASE_PATH = "/tenant-review";

export const tenantReviewPath = (path: string = "") => {
  if (!path || path === "/") {
    return TENANT_REVIEW_BASE_PATH;
  }

  return `${TENANT_REVIEW_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
};
