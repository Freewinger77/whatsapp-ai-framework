export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type BehaviorProfile = 'bot-native' | 'notification-balanced' | 'notification-max';
export type InstanceStatus = 'provisioning' | 'disconnected' | 'connecting' | 'connected' | 'error' | 'suspended';
export type ProxyStatus = 'free' | 'assigned' | 'unhealthy' | 'quarantined' | 'released';

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          clerk_org_id: string | null;
          slug: string;
          name: string;
          plan: string;
          status: string;
          region_preference: string | null;
          api_base_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['organizations']['Row']> & Pick<Database['public']['Tables']['organizations']['Row'], 'slug' | 'name'>;
        Update: Partial<Database['public']['Tables']['organizations']['Row']>;
      };
      instances: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          phone: string | null;
          status: InstanceStatus;
          provisioning_state: string;
          region_code: string;
          worker_namespace: string | null;
          worker_name: string | null;
          worker_endpoint: string | null;
          webhook_url: string | null;
          behavior_profile: BehaviorProfile;
          proxy_policy: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['instances']['Row']> & Pick<Database['public']['Tables']['instances']['Row'], 'org_id' | 'name' | 'region_code'>;
        Update: Partial<Database['public']['Tables']['instances']['Row']>;
      };
      proxy_allocations: {
        Row: {
          id: string;
          org_id: string | null;
          instance_id: string | null;
          provider_id: string | null;
          region_code: string;
          host: string;
          port: number;
          username_ref: string | null;
          password_secret_ref: string | null;
          source: string;
          status: ProxyStatus;
          assigned_at: string | null;
          released_at: string | null;
          last_verified_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['proxy_allocations']['Row']> & Pick<Database['public']['Tables']['proxy_allocations']['Row'], 'region_code' | 'host' | 'port'>;
        Update: Partial<Database['public']['Tables']['proxy_allocations']['Row']>;
      };
      worker_events: {
        Row: {
          id: string;
          org_id: string | null;
          instance_id: string | null;
          event_type: string;
          severity: string;
          summary: string | null;
          payload: Json;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['worker_events']['Row']> & Pick<Database['public']['Tables']['worker_events']['Row'], 'event_type'>;
        Update: Partial<Database['public']['Tables']['worker_events']['Row']>;
      };
    };
    Views: {
      worker_event_feed: {
        Row: {
          id: string;
          org_id: string | null;
          org_slug: string | null;
          instance_id: string | null;
          instance_name: string | null;
          event_type: string;
          severity: string;
          summary: string | null;
          created_at: string;
        };
      };
    };
  };
};
