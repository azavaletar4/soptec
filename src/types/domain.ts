export type ConnectionTechnology = 'fiber' | 'radio' | 'cable' | 'dsl';
export type DocumentType = 'cedula' | 'ruc' | 'pasaporte';
export type ClientStatus = 'prospect' | 'active' | 'suspended' | 'retired';
export type ContractStatus = 'active' | 'suspended' | 'cancelled';

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
  created_at: string;
  updated_at: string;
  zones?: Pick<Zone, 'id' | 'name'> | null;
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
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, 'id' | 'first_name' | 'last_name' | 'document_number'> | null;
  plans?: Pick<Plan, 'id' | 'name' | 'download_speed' | 'upload_speed' | 'price'> | null;
}
