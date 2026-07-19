const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const APP_BASE_PATH = configuredBasePath.replace(/\/$/, "");

export function appPath(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${APP_BASE_PATH}${normalizedPath}`;
}
