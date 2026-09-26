export type ConnectionTechnology = 'fiber' | 'radio' | 'cable' | 'dsl';
export type DocumentType = 'cedula' | 'ruc' | 'pasaporte';
export type ClientStatus = 'prospect' | 'active' | 'suspended' | 'retired';
export type ContractStatus = 'active' | 'suspended' | 'cancelled';
export type ContractPriority = 'high' | 'medium' | 'low';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory =
  | 'no_service'
  | 'slow_speed'
  | 'billing'
  | 'installation'
  | 'equipment'
  | 'reconnection_relocation'
  | 'other';
export type InvoiceStatus = 'pending' | 'paid' | 'cancelled';
export type InstallationStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled';
export type InventoryMovementType = 'ingreso' | 'egreso';
export type InventoryUnitStatus = 'in_stock' | 'assigned' | 'damaged' | 'in_repair' | 'retired';
export type InfraElementoTipo = 'caja_nap' | 'splitter' | 'manga' | 'armario' | 'poste' | 'camara' | 'otro';
export type VehiculoTipo = 'auto' | 'moto';
export type VehiculoEstado = 'activo' | 'mantenimiento' | 'inactivo';
export type MantenimientoTipo = 'preventivo' | 'correctivo';
export type AlertaNivel = 'rojo' | 'amarillo' | 'verde' | 'sin_datos';

/** Tope de clientes por zona de cobertura (regla de negocio, no de esquema). */
export const ZONE_CLIENT_LIMIT = 128;

/** Tope de clientes por caja NAP y de cajas NAP por zona (regla de negocio, no de esquema). */
export const NAP_CLIENT_LIMIT = 16;
export const ZONE_NAP_LIMIT = 16;

/** Umbrales del semaforo de SOAT/mantenimiento de la flota vehicular (regla de negocio, no de esquema). */
export const VEHICULO_DIAS_CRITICO = 7;
export const VEHICULO_DIAS_ADVERTENCIA = 30;
export const VEHICULO_KM_ADVERTENCIA = 500;

export interface Zone {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  download_speed: number;
  upload_speed: number;
  price: number;
  technology: ConnectionTechnology;
  burst_download: number | null;
  burst_upload: number | null;
  mikrotik_profile: string | null;
  olt_tcont_profile: string | null;
  olt_traffic_profile: string | null;
  is_debt_suspension_plan: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Client {
  id: string;
  zone_id: string | null;
  client_code: string | null;
  document_type: DocumentType;
  document_number: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone_2: string | null;
  email: string | null;
  address: string | null;
  birthdate: string | null;
  status: ClientStatus;
  latitude: number | null;
  longitude: number | null;
  /** Credito acumulado por pagos en exceso o descuentos de referido que sobraron (Fase 33) — se consume solo en la siguiente factura. */
  saldo_a_favor: number;
  created_at: string;
  updated_at: string;
  zones?: Pick<Zone, 'id' | 'name'> | null;
}

export type ClientPhotoCategory = 'facade' | 'service_sheet' | 'modem_position' | 'nap_box' | 'pon_power';

export interface ClientPhoto {
  id: string;
  client_id: string;
  /** A que servicio/linea pertenece esta foto (Fase 38) — null en fotos viejas de clientes multi-servicio, pendientes de reasignar a mano. */
  contract_id: string | null;
  category: ClientPhotoCategory;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface ServiceContract {
  id: string;
  contract_number: string | null;
  /** Codigo de cliente de ESTE servicio (Fase 39) — un titular puede tener varios, uno por linea; clients.client_code queda como dato heredado. */
  client_code: string | null;
  client_id: string;
  plan_id: string | null;
  monthly_fee: number;
  status: ContractStatus;
  /** Prioridad de atencion de ESTE servicio (Fase 41), en la pestaña "General". */
  priority: ContractPriority;
  start_date: string;
  end_date: string | null;
  billing_day: number;
  payment_method: string | null;
  /** Ubicacion de ESTA instalacion (Fase 37) — puede diferir de la del titular si tiene mas de un servicio. */
  installation_address: string | null;
  installation_reference: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Zona de ESTA instalacion (Fase 38) — clients.zone_id queda como dato heredado, ya no se edita. */
  zone_id: string | null;
  zones?: Pick<Zone, 'id' | 'name'> | null;
  mikrotik_device_id: string | null;
  pppoe_username: string | null;
  mikrotik_profile: string | null;
  xui_line_id: number | null;
  xui_username: string | null;
  debt_hold_status: DebtHoldStatus;
  debt_hold_flagged_at: string | null;
  debt_hold_applied_at: string | null;
  debt_hold_invoice_id: string | null;
  mikrotik_profile_before_hold: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name' | 'document_number' | 'phone'> | null;
  plans?: Pick<Plan, 'id' | 'name' | 'download_speed' | 'upload_speed' | 'price'> | null;
  invoices?: Pick<Invoice, 'id' | 'invoice_number' | 'due_date' | 'amount'> | null;
}

export type DebtHoldStatus = 'none' | 'pending' | 'suspended';

export interface DebtHoldEvent {
  id: string;
  contract_id: string;
  event_type: 'flagged' | 'applied' | 'reactivated' | 'error';
  invoice_id: string | null;
  detail: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StaffProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
}

export type StaffRole = 'SUPERADMIN' | 'ADMIN' | 'TECNICO_RED' | 'SOPORTE' | 'FACTURACION';

export interface UserAccount {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  phone: string | null;
  role: StaffRole;
  active: boolean;
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string | null;
  client_id: string;
  contract_id: string | null;
  title: string;
  description: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: string | null;
  points: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name' | 'phone'> | null;
  assigned_profile?: Pick<StaffProfile, 'id' | 'full_name' | 'email'> | null;
}

export interface Installation {
  id: string;
  client_id: string;
  contract_id: string | null;
  status: InstallationStatus;
  scheduled_date: string | null;
  scheduled_time: string | null;
  assigned_to: string | null;
  notes: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name' | 'phone' | 'address' | 'latitude' | 'longitude'> | null;
  contracts?: Pick<ServiceContract, 'id' | 'contract_number'> | null;
  assigned_profile?: Pick<StaffProfile, 'id' | 'full_name' | 'email'> | null;
}

export interface InventoryProduct {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  price: number;
  min_stock: number;
  current_stock: number;
  is_active: boolean;
  is_serialized: boolean;
  purchase_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryUnit {
  id: string;
  product_id: string;
  serial_number: string | null;
  mac_address: string | null;
  status: InventoryUnitStatus;
  client_id: string | null;
  /** A que servicio/linea del cliente esta asignado este equipo (Fase 37) — null en clientes con un solo contrato historico (backfill automatico) o pendiente de asignar a mano. */
  contract_id: string | null;
  installation_id: string | null;
  assigned_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  product?: Pick<InventoryProduct, 'id' | 'name' | 'category'> | null;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name' | 'document_number'> | null;
}

export interface InventoryUnitEvent {
  id: string;
  unit_id: string;
  from_status: InventoryUnitStatus | null;
  to_status: InventoryUnitStatus;
  client_id: string | null;
  installation_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  author?: Pick<StaffProfile, 'id' | 'full_name' | 'email'> | null;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name'> | null;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  movement_type: InventoryMovementType;
  quantity: number;
  reason: string | null;
  balance_after: number;
  ticket_id: string | null;
  installation_id: string | null;
  created_by: string | null;
  created_at: string;
  author?: Pick<StaffProfile, 'id' | 'full_name' | 'email'> | null;
  product?: Pick<InventoryProduct, 'id' | 'name' | 'unit'> | null;
}

export interface InfraElemento {
  id: string;
  name: string;
  tipo: InfraElementoTipo;
  potencia: string | null;
  spliteo: string | null;
  puertos_total: number | null;
  is_active: boolean;
  photo_path: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  zone_id: string | null;
  kml_ref: string | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Fase 8: fibra optica (cables, hilos, fusiones, puertos NAP) ----

export type FoCableTipo = 'troncal' | 'ramal';
export const FO_HILOS_TOTAL_OPCIONES = [6, 12, 24, 48, 72, 96, 144] as const;
export type FoHilosTotal = (typeof FO_HILOS_TOTAL_OPCIONES)[number];
export type FoHiloEstadoTipo = 'libre' | 'usado' | 'reservado' | 'dañado';
export type FoFusionDestinoTipo = 'cable' | 'splitter_out' | 'terminado';
export type FoNapPuertoEstado = 'libre' | 'ocupado' | 'reservado' | 'dañado';

/** Punto GPS [lat, lng]. */
export type LatLngPoint = [number, number];

export interface FoCable {
  id: string;
  codigo: string;
  tipo: FoCableTipo;
  hilos_total: FoHilosTotal;
  metraje: number | null;
  path: LatLngPoint[];
  origen_olt_id: string | null;
  origen_infra_id: string | null;
  destino_olt_id: string | null;
  destino_infra_id: string | null;
  is_active: boolean;
  notes: string | null;
  kml_ref: string | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Fase 29: registro de una importacion de mapa desde KML/KMZ. */
export interface MapImport {
  id: string;
  source_filename: string;
  summary: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface FoHiloEstado {
  id: string;
  cable_id: string;
  hilo_index: number;
  estado: FoHiloEstadoTipo;
  notes: string | null;
  updated_at: string;
}

export interface FoFusion {
  id: string;
  infra_elemento_id: string;
  cable_a_id: string;
  hilo_a_index: number;
  destino_tipo: FoFusionDestinoTipo;
  cable_b_id: string | null;
  hilo_b_index: number | null;
  puerto_nap: number | null;
  notes: string | null;
  created_at: string;
}

export interface FoNapPuerto {
  id: string;
  infra_elemento_id: string;
  puerto_numero: number;
  estado: FoNapPuertoEstado;
  client_id: string | null;
  /** A que servicio/linea del cliente pertenece este puerto (Fase 38) — null en casos ambiguos (cliente multi-servicio) pendientes de reasignar a mano. */
  contract_id: string | null;
  fusion_id: string | null;
  notes: string | null;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name'> | null;
  service_contracts?: Pick<ServiceContract, 'id' | 'contract_number'> | null;
}

export interface Tr069Device {
  id: string;
  genieacs_id: string;
  cpe_oui: string | null;
  cpe_product_class: string | null;
  cpe_serial: string;
  service_contract_id: string | null;
  notes: string | null;
  last_seen_at: string | null;
  model_name: string | null;
  firmware_version: string | null;
  wan_ip: string | null;
  ssid: string | null;
  created_at: string;
  updated_at: string;
  contracts?: Pick<ServiceContract, 'id' | 'contract_number'> | null;
}

export interface Tr069PerformanceMetric {
  id: string;
  tr069_device_id: string;
  rx_power: number | null;
  tx_power: number | null;
  temperature: number | null;
  uptime: number | null;
  connection_status: string | null;
  collected_at: string;
  created_at: string;
}

export interface OltTr069AcsProfile {
  id: string;
  olt_device_id: string;
  profile_name: string;
  acs_url: string;
  acs_username: string | null;
  acs_password: string | null;
  inform_interval: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: Pick<StaffProfile, 'id' | 'full_name' | 'email'> | null;
}

export interface Invoice {
  id: string;
  invoice_number: string | null;
  contract_id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  /** Monto realmente cobrado (Fase 33) — nulo en facturas de antes de esta fase o aun no pagadas. */
  amount_paid: number | null;
  /** Saldo neto pendiente (amount menos sus invoice_adjustments) — lo mantiene un trigger (Fase 33b). */
  amount_due: number;
  due_date: string;
  status: InvoiceStatus;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name' | 'document_number'> | null;
  service_contracts?: Pick<ServiceContract, 'id' | 'contract_number'> | null;
}

export type ReferidoEstado = 'pendiente' | 'aplicado' | 'cancelado';
export type InvoiceAdjustmentTipo = 'averia' | 'referido' | 'saldo_a_favor' | 'promo_4to_gratis';
export type ClientCreditMovementTipo =
  | 'pago_excedente'
  | 'consumo_saldo_favor'
  | 'referido_sobrante'
  | 'averia_sobrante'
  | 'ajuste_manual';
export type DescuentoCompensacionEstado = 'pendiente' | 'aplicado' | 'cancelado';
export type DescuentoCompensacionCriterio = 'zona' | 'olt' | 'nap';

/** Descuento de S/25 por recomendar un nuevo cliente (Fase 33) — se aplica solo en la siguiente factura del referente. */
export interface Referido {
  id: string;
  referente_client_id: string;
  referido_client_id: string;
  monto_descuento: number;
  estado: ReferidoEstado;
  invoice_id: string | null;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
  referido?: Pick<Client, 'id' | 'first_name' | 'last_name'> | null;
}

/** Una linea del desglose de descuentos/creditos aplicados a una factura (Fase 33). */
export interface InvoiceAdjustment {
  id: string;
  invoice_id: string;
  tipo: InvoiceAdjustmentTipo;
  descripcion: string;
  monto: number;
  referido_id: string | null;
  created_at: string;
}

/** Auditoria insert-only del saldo a favor de un cliente (Fase 33). */
export interface ClientCreditMovement {
  id: string;
  client_id: string;
  tipo: ClientCreditMovementTipo;
  monto: number;
  saldo_resultante: number;
  invoice_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** Pago adelantado de 3 meses con el 4to gratis (Fase 33) — el trigger de la BD crea las 4 facturas. */
export interface PagoAdelantado {
  id: string;
  contract_id: string;
  client_id: string;
  meses_pagados: number;
  monto_total: number;
  payment_method: string | null;
  invoice_ids: string[] | null;
  created_by: string | null;
  created_at: string;
}

/** Descuento manual por averia/compensacion de servicio (Fase 34) — individual o de un lote masivo. */
export interface DescuentoCompensacion {
  id: string;
  client_id: string;
  /** null = compensacion para el cliente completo; con valor, solo aplica a facturas de ESE contrato (Fase 37). */
  contract_id: string | null;
  monto: number;
  motivo: string;
  estado: DescuentoCompensacionEstado;
  invoice_id: string | null;
  lote_id: string | null;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name'> | null;
}

/** Metadata de una aplicacion masiva de descuento por averia (por zona/OLT/caja NAP). */
export interface DescuentoCompensacionLote {
  id: string;
  criterio: DescuentoCompensacionCriterio;
  criterio_id: string;
  motivo: string;
  monto: number | null;
  porcentaje: number | null;
  clientes_afectados: number;
  created_by: string | null;
  created_at: string;
}

export interface Vehiculo {
  id: string;
  tipo: VehiculoTipo;
  placa: string;
  marca: string;
  modelo: string | null;
  tecnico_id: string | null;
  area: string | null;
  estado: VehiculoEstado;
  soat_fecha_emision: string | null;
  soat_fecha_vencimiento: string | null;
  soat_aseguradora: string | null;
  /** Ruta del archivo dentro del bucket privado 'vehiculo-soat' (no una URL publica) — ver soatUrl en VehiculoWithUrl. */
  soat_archivo_path: string | null;
  kilometraje_actual: number;
  fecha_ultimo_mantenimiento: string | null;
  tipo_ultimo_mantenimiento: MantenimientoTipo | null;
  proximo_mantenimiento_fecha: string | null;
  proximo_mantenimiento_km: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tecnico?: Pick<StaffProfile, 'id' | 'full_name' | 'email'> | null;
}

export type JobType = 'installation' | 'ticket';

/** Cierre de un trabajo de campo (alta o averia) — GPS del cierre, serial de
 *  ONT leido por QR y firma de conformidad. Ver Fase 32. */
export interface WorkOrderClosure {
  id: string;
  job_type: JobType;
  job_id: string;
  client_id: string;
  latitude: number | null;
  longitude: number | null;
  ont_serial: string | null;
  closure_notes: string | null;
  signature_path: string | null;
  closed_by: string | null;
  created_at: string;
}

/** Galeria de evidencia fotografica de un cierre de trabajo (no tiene slot
 *  fijo por categoria como client_photos: una averia puede visitarse mas de
 *  una vez y cada cierre conserva sus propias fotos). */
export interface WorkOrderPhoto {
  id: string;
  job_type: JobType;
  job_id: string;
  category: string;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface MantenimientoHistorial {
  id: string;
  vehiculo_id: string;
  fecha: string;
  tipo: MantenimientoTipo;
  descripcion: string | null;
  costo: number | null;
  taller: string | null;
  kilometraje: number | null;
  created_by: string | null;
  created_at: string;
  author?: Pick<StaffProfile, 'id' | 'full_name' | 'email'> | null;
}

export type CajaChicaTipo = 'ingreso' | 'egreso';

/** Categoria editable (Fase 43) — el usuario puede crear una nueva desde el
 *  formulario y queda disponible para el resto de los movimientos. */
export interface CajaChicaCategoria {
  id: string;
  nombre: string;
  /** Si true, el formulario ofrece vincular el movimiento a un vehiculo de Flota. */
  permite_vehiculo: boolean;
  created_at: string;
}

export interface CajaChicaMovimiento {
  id: string;
  fecha: string;
  tipo: CajaChicaTipo;
  categoria_id: string;
  monto: number;
  descripcion: string;
  responsable: string;
  vehiculo_id: string | null;
  /** Ruta dentro del bucket privado 'caja-chica-comprobantes' (no una URL publica) — ver url en CajaChicaMovimientoWithUrl. */
  comprobante_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  caja_chica_categorias?: Pick<CajaChicaCategoria, 'id' | 'nombre' | 'permite_vehiculo'> | null;
  vehiculos?: Pick<Vehiculo, 'id' | 'placa' | 'marca' | 'modelo'> | null;
}
