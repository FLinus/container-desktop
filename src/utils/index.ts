import merge from "deepmerge";

export function deepMerge<T = any>(x: Partial<T>, ...y: Partial<T & any>[]) {
  return merge.all<Partial<T>>([x, ...y], {
    arrayMerge: (_, source) => source,
    isMergeableObject: (value) => value && typeof value === "object" && !Array.isArray(value)
  }) as T;
}

export function axiosConfigToCURL(config) {
  if (!config || !config.baseURL || !config.socketPath) {
    console.error("Request config is not valid", config);
    throw new Error("Unable to construct curl from config");
  }
  let requestUrl = `${config.baseURL}${config.url}`;
  if (Object.keys(config.params || {}).length) {
    const searchParams = new URLSearchParams();
    Object.entries(config.params).forEach(([key, value]) => searchParams.set(key, `${value}`));
    requestUrl = `${requestUrl}?${searchParams}`;
  }
  const command = ["curl", "-v", "-X", config.method?.toUpperCase(), "--unix-socket", `"${config.socketPath.replace("unix://", "").replace("npipe://", "")}"`, `"${requestUrl}"`];
  const exclude = ["common", "delete", "get", "head", "patch", "post", "put"];
  const extractHeaders = (bag) => {
    const headers = {};
    Object.entries(bag || {}).forEach(([key, value]) => {
      if (exclude.includes(key)) {
        return;
      }
      headers[key] = `${value}`;
    });
    return headers;
  };
  const commonHeaders = extractHeaders(config.headers?.common);
  const methodHeaders = config.method ? extractHeaders(config.headers[config.method]) : {};
  const userHeaders = extractHeaders(config.headers);
  const headers = { ...commonHeaders, ...methodHeaders, ...userHeaders };
  Object.entries(headers).forEach(([key, value]) => {
    command.push(`-H "${key}: ${value}"`);
  });
  if (config.method !== "get" && config.method !== "head") {
    if (typeof config.data !== "undefined") {
      command.push("-d", `'${JSON.stringify(config.data)}'`);
    }
  }
  return command.join(" ");
}

export default {
  axiosConfigToCURL
};
