// Solo recibos. No altera el logo ni la identidad general de AppLayout.
let assets:Record<string,unknown>={};
try{assets=import.meta.glob('../assets/receipt-logo-horizontal.webp',{eager:true,query:'?url',import:'default'});}catch{/* Tests Node sin macro Vite; no se inventa un recurso gráfico. */}
export const receiptBrandLogo=(assets['../assets/receipt-logo-horizontal.webp'] as string|undefined)??null;
