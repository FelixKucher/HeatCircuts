// Adresse der web-ifc-wasm-Datei; in der Einzeldatei als data:-URL eingebettet.
import wasmUrl from 'web-ifc/web-ifc.wasm?url';

export const locateWasm = (path: string): string => (path.endsWith('.wasm') ? wasmUrl : path);
