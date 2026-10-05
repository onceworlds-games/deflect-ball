// Module hooks for the headless run: `three` gets a stand-in renderer (there is no GPU here) and CSS imports are empty.
const shim = new URL('./three-shim.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'three' && context.parentURL !== shim) return { url: shim, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return next(url, context);
}
