// Source: https://sdk.myinvois.hasil.gov.my/codes/tax-types/
export const TAX_TYPES: Record<string, string> = {
  "01": "Sales Tax",
  "02": "Service Tax",
  "03": "Tourism Tax",
  "04": "High-Value Goods Tax",
  "05": "Sales Tax on Low Value Goods",
  "06": "Not Applicable",
  E: "Tax exemption (where applicable)",
};

// Source: https://sdk.myinvois.hasil.gov.my/codes/payment-methods/
export const PAYMENT_METHODS: Record<string, string> = {
  "01": "Cash",
  "02": "Cheque",
  "03": "Bank Transfer",
  "04": "Credit Card",
  "05": "Debit Card",
  "06": "e-Wallet / Digital Wallet",
  "07": "Digital Bank",
  "08": "Others",
};

// Source: https://sdk.myinvois.hasil.gov.my/codes/state-codes/
export const STATE_CODES: Record<string, string> = {
  "01": "Johor",
  "02": "Kedah",
  "03": "Kelantan",
  "04": "Melaka",
  "05": "Negeri Sembilan",
  "06": "Pahang",
  "07": "Pulau Pinang",
  "08": "Perak",
  "09": "Perlis",
  "10": "Selangor",
  "11": "Terengganu",
  "12": "Sabah",
  "13": "Sarawak",
  "14": "Wilayah Persekutuan Kuala Lumpur",
  "15": "Wilayah Persekutuan Labuan",
  "16": "Wilayah Persekutuan Putrajaya",
  "17": "Not Applicable",
};

/**
 * General TINs used when a real counterparty TIN cannot be obtained.
 * Source: LHDN e-Invoice Guideline + SDK FAQ. See README for citations.
 */
export const GENERAL_TINS: Record<string, string> = {
  EI00000000010: "General public (Malaysian individual, e.g. consolidated e-Invoice buyer)",
  EI00000000020: "Foreign buyer / foreign shipping recipient",
  EI00000000030: "Foreign supplier (self-billed / import transactions)",
  EI00000000040: "Government and related / exempt entities",
};
