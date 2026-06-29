export type MenuRoute = "home" | "worlds" | "create" | "loading" | "settings" | "credits";

export interface MenuPage {
  readonly route: MenuRoute;
  readonly element: HTMLElement;
  focusPrimary(): void;
}

export function clearElement(element: HTMLElement): void {
  while (element.firstChild) element.firstChild.remove();
}

export function button(label: string, onClick: () => void, tone = "", primary = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = `ui-button ${tone}`.trim();
  element.type = "button";
  element.textContent = label;
  if (primary) element.dataset.primary = "true";
  element.addEventListener("click", onClick);
  return element;
}

export function field(label: string, input: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.append(label, input);
  return wrapper;
}

export function textInput(className: string, placeholder: string, maxLength = 96): HTMLInputElement {
  const input = document.createElement("input");
  input.className = className;
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  return input;
}

export function selectInput<T extends string>(className: string, options: Array<{ value: T; label: string }>): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = className;
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }
  return select;
}

export function focusPrimary(container: HTMLElement): void {
  const target = container.querySelector<HTMLElement>("[data-primary='true']:not(:disabled)")
    ?? container.querySelector<HTMLElement>("button:not(:disabled), input, select");
  target?.focus();
}
