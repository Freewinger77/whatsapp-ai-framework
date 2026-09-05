export type RecordKind = "customer" | "enquiry" | "nps" | "testimonial" | "booking";
export type BookingStatus = "fitted" | "abandoned" | "cancelled" | "new" | "other";
export type EnquiryChannel = "email" | "phone";

export interface SmtCustomer {
  smtId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  postcode: string | null;
  source: string | null;
  stage: string | null;
  lastBookingAt: string | null;
  raw: Record<string, unknown>;
}

export interface SmtEnquiry {
  smtId: string;
  customerSmtId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  status: string | null;
  source: string | null;
  notes: string | null;
  channel: EnquiryChannel;
  message: string | null;
  tags: string | null;
  enquiredAt: string | null;
  inHours: boolean;
  raw: Record<string, unknown>;
}

export interface SmtNps {
  smtId: string;
  score: number;
  reason: string | null;
  comment: string | null;
  name: string | null;
  phone: string | null;
  phoneE164: string | null;
  scoredAt: string | null;
  raw: Record<string, unknown>;
}

export interface SmtBooking {
  smtId: string;
  customerName: string;
  customerKey: string;
  customerSmtId: string | null;
  vrn: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  status: string | null;
  statusNorm: BookingStatus;
  siteStatus: string | null;
  createdAt: string | null;
  fittingAt: string | null;
  inHours: boolean;
  orderTotal: number | null;
  currency: string | null;
  tyreQty: number;
  services: string[];
  tags: string | null;
  raw: Record<string, unknown>;
}

export interface SmtTestimonial {
  smtId: string;
  name: string;
  quote: string;
  publishedAt: string | null;
  raw: Record<string, unknown>;
}

export interface ListPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  source: "xhr" | "html" | "csv" | "mock";
  url: string;
}

export interface SmtPing {
  ok: boolean;
  detail?: string;
  headlineNps?: number | null;
}

export interface SmtClient {
  login(): Promise<void>;
  ensureSession(): Promise<void>;
  ping(): Promise<SmtPing>;
  listCustomers(page?: number, pageSize?: number): Promise<ListPage<SmtCustomer>>;
  listEnquiries(page?: number, pageSize?: number): Promise<ListPage<SmtEnquiry>>;
  listNps(page?: number, pageSize?: number): Promise<ListPage<SmtNps>>;
  listTestimonials(page?: number, pageSize?: number): Promise<ListPage<SmtTestimonial>>;
  exportCustomersCsv(): Promise<SmtCustomer[]>;
  exportEnquiriesCsv(): Promise<SmtEnquiry[]>;
  listHomeActivity(): Promise<SmtHomeActivity[]>;
  headlineNps(): Promise<number | null>;
}

export interface SmtHomeActivity {
  kind: "phone_enquiry" | "email_enquiry" | "nps" | "order" | "other";
  title: string;
  at: string | null;
  href: string | null;
  viewId: string | null;
}

export const CRM_PATHS = {
  login: "/Account/Login",
  loginPost: "/",
  hub: "/FittingCentre/CRM",
  customers: "/FittingCentre/CRM/Customers",
  customersList: "/FittingCentre/CRM/Customers/List",
  customersExport: "/FittingCentre/CRM/Export",
  enquiriesExport: "/FittingCentre/CRM/ExportEnquiries",
  enquiries: "/FittingCentre/CRM/Enquiries",
  enquiriesList: "/FittingCentre/CRM/Enquiries/List",
  nps: "/FittingCentre/CRM/NPS",
  npsList: "/FittingCentre/CRM/NPS/List",
  testimonials: "/FittingCentre/CRM/Testimonials",
  testimonialsList: "/FittingCentre/CRM/Testimonials/List",
  reports: "/FittingCentre/Reports",
  reportsBrandsSold: "/FittingCentre/Reports/BrandsSold",
  home: "/FittingCentre",
  enquiryView: "/FittingCentre/CRM/EnquiriesView",
} as const;
