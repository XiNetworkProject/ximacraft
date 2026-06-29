export function createXimaCraftLogo(compact = false): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = compact ? "ximacraft-logo compact" : "ximacraft-logo";
  const img = document.createElement("img");
  img.src = compact ? "/assets/ui/ximacraft-mark.svg" : "/assets/ui/ximacraft-logo.svg";
  img.alt = compact ? "XimaCraft" : "XimaCraft";
  wrapper.append(img);
  return wrapper;
}
