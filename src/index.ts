export function hello() {
  return "DLMM Agent starting...";
}

if (import.meta.main) {
  console.log(hello());
}
