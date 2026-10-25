/** Una baja comercial no se revierte por pagar deuda histórica. */
export function assertClientCanReactivate(contractStatus: string, clientStatus: string | null | undefined) {
  if (contractStatus === 'cancelled' || clientStatus === 'retired') {
    throw new Error('Contrato cancelado o cliente en Baja: el pago se conserva y no autoriza reactivar el servicio. Requiere revisión de reincorporación.');
  }
  if (!clientStatus) throw new Error('No se pudo validar la ficha del cliente; no se reactivará el servicio.');
}
