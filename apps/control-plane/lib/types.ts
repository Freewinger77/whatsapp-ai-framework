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
          subdomain: string | null;
          deployment_status: string;
          billing_customer_id: string | null;
          trial_started_at: string | null;
          trial_ends_at: string | null;
          trial_locked_at: string | null;
          vm_delete_after: string | null;
          trial_instance_limit: number;
          trial_message_credits: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['organizations']['Row']> & Pick<Database['public']['Tables']['organizations']['Row'], 'slug' | 'name'>;
        Update: Partial<Database['public']['Tables']['organizations']['Row']>;
      };
      org_deployments: {
        Row: {
          id: string;
          org_id: string;
          environment: string;
          status: 'not_started' | 'queued' | 'provisioning' | 'dns_pending' | 'ready' | 'failed' | 'suspended';
          azure_subscription_id: string | null;
          azure_resource_group: string | null;
          azure_region: string | null;
          vm_name: string | null;
          vm_size: string;
          public_ip: string | null;
          fqdn: string | null;
          base_url: string | null;
          worker_api_key_public_id: string | null;
          worker_api_key_hash: string | null;
          worker_api_key_salt: string | null;
          internal_secret_hash: string | null;
          internal_secret_salt: string | null;
          deployed_version: string | null;
          health: Json;
          last_error: string | null;
          requested_at: string;
          provisioned_at: string | null;
          dns_ready_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['org_deployments']['Row']> & Pick<Database['public']['Tables']['org_deployments']['Row'], 'org_id'>;
        Update: Partial<Database['public']['Tables']['org_deployments']['Row']>;
      };
      api_keys: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          public_id: string;
          secret_hash: string;
          salt: string;
          scopes: string[];
          allowed_instance_ids: string[] | null;
          key_kind: 'live' | 'test' | 'worker' | 'internal';
          metadata: Json;
          created_by: string | null;
          created_at: string;
          last_used_at: string | null;
          expires_at: string | null;
          revoked_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['api_keys']['Row']> & Pick<Database['public']['Tables']['api_keys']['Row'], 'org_id' | 'name' | 'public_id' | 'secret_hash' | 'salt'>;
        Update: Partial<Database['public']['Tables']['api_keys']['Row']>;
      };
      instances: {
        Row: {
          id: string;
          org_id: string;
          legacy_instance_id: string | null;
          name: string;
          phone: string | null;
          status: InstanceStatus;
          provisioning_state: string;
          region_code: string;
          worker_namespace: string | null;
          worker_name: string | null;
          worker_endpoint: string | null;
          webhook_url: string | null;
          webhook_secret_ref: string | null;
          behavior_profile: BehaviorProfile;
          notification_grace_ms: number;
          antiban_preset: string;
          proxy_policy: string;
          metadata: Json;
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
          egress_ip: string | null;
          label: string | null;
          username_encrypted: string | null;
          password_encrypted: string | null;
          credential_secret_ref: string | null;
          proxy_type: 'http' | 'https' | 'socks4' | 'socks5';
          assigned_by: string | null;
          assigned_at: string | null;
          released_at: string | null;
          last_verified_at: string | null;
          health: Json;
          created_at: string;
          updated_at: string;
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
      instance_messages: {
        Row: {
          id: string;
          org_id: string;
          instance_id: string | null;
          external_message_id: string | null;
          direction: 'inbound' | 'outbound';
          phone: string | null;
          contact_name: string | null;
          body: string | null;
          status: string;
          metadata: Json;
          sent_at: string | null;
          received_at: string | null;
          seen_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['instance_messages']['Row']> & Pick<Database['public']['Tables']['instance_messages']['Row'], 'org_id' | 'direction'>;
        Update: Partial<Database['public']['Tables']['instance_messages']['Row']>;
      };
      handoff_numbers: {
        Row: {
          id: string;
          org_id: string;
          instance_id: string | null;
          phone: string;
          label: string | null;
          status: 'active' | 'paused' | 'released';
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['handoff_numbers']['Row']> & Pick<Database['public']['Tables']['handoff_numbers']['Row'], 'org_id' | 'phone'>;
        Update: Partial<Database['public']['Tables']['handoff_numbers']['Row']>;
      };
      instance_profiles: {
        Row: {
          id: string;
          org_id: string;
          instance_id: string;
          display_name: string | null;
          about: string | null;
          picture_url: string | null;
          picture_status: string;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['instance_profiles']['Row']> & Pick<Database['public']['Tables']['instance_profiles']['Row'], 'org_id' | 'instance_id'>;
        Update: Partial<Database['public']['Tables']['instance_profiles']['Row']>;
      };
      notification_events: {
        Row: {
          id: string;
          org_id: string | null;
          event_type: string;
          recipient: string;
          subject: string;
          status: 'queued' | 'sent' | 'failed' | 'skipped';
          provider: string;
          idempotency_key: string | null;
          error: string | null;
          metadata: Json;
          created_at: string;
          sent_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['notification_events']['Row']> & Pick<Database['public']['Tables']['notification_events']['Row'], 'event_type' | 'recipient' | 'subject'>;
        Update: Partial<Database['public']['Tables']['notification_events']['Row']>;
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
      proxy_pool_summary: {
        Row: {
          region_code: string;
          total: number;
          free: number;
          assigned: number;
          unavailable: number;
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
