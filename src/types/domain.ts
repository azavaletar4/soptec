export type ConnectionTechnology = 'fiber' | 'radio' | 'cable' | 'dsl';
export type DocumentType = 'cedula' | 'ruc' | 'pasaporte';
export type ClientStatus = 'prospect' | 'active' | 'suspended' | 'retired';
export type ContractStatus = 'active' | 'suspended' | 'cancelled';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory = 'no_service' | 'slow_speed' | 'billing' | 'installation' | 'equipment' | 'other';
export type InvoiceStatus = 'pending' | 'paid' | 'cancelled';

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
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Client {
  id: string;
  zone_id: string | null;
  document_type: DocumentType;
  document_number: string;
  first_name: string;
  last_name: string;
  phone: string | null;
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

export type ClientPhotoCategory = 'facade' | 'service_sheet' | 'modem_position';

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
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name' | 'document_number'> | null;
  plans?: Pick<Plan, 'id' | 'name' | 'download_speed' | 'upload_speed' | 'price'> | null;
}

export interface StaffProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
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
