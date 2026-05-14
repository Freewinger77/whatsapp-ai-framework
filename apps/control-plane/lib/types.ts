export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type BehaviorProfile = 'bot-native' | 'notification-balanced' | 'notification-max';
export type InstanceStatus = 'provisioning' | 'disconnected' | 'connecting' | 'connected' | 'error' | 'suspended';
export type ProxyStatus = 'free' | 'assigned' | 'unhealthy' | 'quarantined' | 'released';
export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused' | 'inactive';

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
          billing_customer_id: string | null;
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
      usage_events: {
        Row: {
          id: string;
          org_id: string;
          instance_id: string | null;
          event_type: string;
          quantity: number;
          unit: string;
          metadata: Json;
          idempotency_key: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['usage_events']['Row']> & Pick<Database['public']['Tables']['usage_events']['Row'], 'org_id' | 'event_type'>;
        Update: Partial<Database['public']['Tables']['usage_events']['Row']>;
      };
      billing_entitlements: {
        Row: {
          id: string;
          org_id: string;
          provider: string;
          provider_customer_id: string | null;
          provider_subscription_id: string | null;
          status: BillingStatus;
          plan_key: string;
          paid_instance_limit: number;
          reserved_instance_count: number;
          included_message_credits: number;
          extra_message_credits: number;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['billing_entitlements']['Row']> & Pick<Database['public']['Tables']['billing_entitlements']['Row'], 'org_id'>;
        Update: Partial<Database['public']['Tables']['billing_entitlements']['Row']>;
      };
      credit_ledger_entries: {
        Row: {
          id: string;
          org_id: string;
          instance_id: string | null;
          source: 'stripe' | 'usage' | 'manual' | 'system';
          event_type: string;
          quantity: number;
          balance_after: number | null;
          idempotency_key: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['credit_ledger_entries']['Row']> & Pick<Database['public']['Tables']['credit_ledger_entries']['Row'], 'org_id' | 'source' | 'event_type' | 'quantity'>;
        Update: Partial<Database['public']['Tables']['credit_ledger_entries']['Row']>;
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
      org_billing_summary: {
        Row: {
          org_id: string;
          slug: string;
          name: string;
          plan: string;
          org_status: string;
          billing_customer_id: string | null;
          billing_status: BillingStatus;
          paid_instance_limit: number;
          reserved_instance_count: number;
          active_instance_count: number;
          available_instance_slots: number;
          message_credit_balance: number;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean | null;
        };
      };
    };
  };
};
