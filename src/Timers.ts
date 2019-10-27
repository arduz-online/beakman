export const performanceNow: () => number =
  (typeof performance !== "undefined" && performance.now.bind(performance)) || Date.now.bind(Date);
