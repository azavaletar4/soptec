export interface Tr069LiveDevice {
  genieacs_id: string;
  cpe_serial: string;
  cpe_oui: string | null;
  cpe_product_class: string | null;
  last_seen_at: string | null;
  model_name: string | null;
  firmware_version: string | null;
  wan_ip: string | null;
  ssid: string | null;
}

export interface Tr069InventorySnapshot {
  checkedAt: string;
  total: number;
  devices: Tr069LiveDevice[];
}
