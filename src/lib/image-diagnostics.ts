import { addBreadcrumb } from "./sentry.ts"

// Breadcrumbs for chat image rendering (Android blank-grey-box investigation).
// scheme/length let us tell data: URIs from file/http without leaking the base64.

export function imageError(where: string, url: string, error: string): void {
  addBreadcrumb({
    category: "image",
    message: `${where}: load error`,
    level: "error",
    data: { scheme: url.slice(0, 30), length: url.length, error },
  })
}

export function imageLoad(where: string, url: string, width: number, height: number): void {
  addBreadcrumb({
    category: "image",
    message: `${where}: loaded`,
    data: { scheme: url.slice(0, 30), length: url.length, width, height },
  })
}
