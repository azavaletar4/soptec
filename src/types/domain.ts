export type ConnectionTechnology = 'fiber' | 'radio' | 'cable' | 'dsl';
export type DocumentType = 'cedula' | 'ruc' | 'pasaporte';
export type ClientStatus = 'prospect' | 'active' | 'suspended' | 'retired';
export type ContractStatus = 'active' | 'suspended' | 'cancelled';
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

/** Tope de clientes por zona de cobertura (regla de negocio, no de esquema). */
export const ZONE_CLIENT_LIMIT = 128;

/** Tope de clientes por caja NAP y de cajas NAP por zona (regla de negocio, no de esquema). */
export const NAP_CLIENT_LIMIT = 16;
export const ZONE_NAP_LIMIT = 16;

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
  created_at: string;
  updated_at: string;
  zones?: Pick<Zone, 'id' | 'name'> | null;
}

export type ClientPhotoCategory = 'facade' | 'service_sheet' | 'modem_position' | 'nap_box';

export interface ClientPhoto {
  id: string;
  client_id: string;
  category: ClientPhotoCategory;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface ServiceContract {
  id: string;
  contract_number: string | null;
  client_id: string;
  plan_id: string | null;
  monthly_fee: number;
  status: ContractStatus;
  start_date: string;
  end_date: string | null;
  billing_day: number;
  payment_method: string | null;
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
  fusion_id: string | null;
  notes: string | null;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name'> | null;
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
