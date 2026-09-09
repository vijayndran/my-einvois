import type { Party, ValidationIssue } from "../types.js";
import { COUNTRY_CODES } from "../data/country-codes.js";
import { STATE_CODES } from "../data/codes.js";
import { validateTin } from "./tin.js";
import { err, warn, EMAIL_RE, PHONE_RE } from "./common.js";

const MSIC_RE = /^\d{5}$/;

export function validateParty(
  party: Party,
  role: "Supplier" | "Buyer",
  opts: { requireMsic: boolean; requireContact: boolean }
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (suffix: string) => `${role}.${suffix}`;

  if (!party.name || party.name.trim() === "") {
    issues.push(err(`${role.toUpperCase()}-NAME`, `${role} name is mandatory.`, p("Name")));
  }

  issues.push(...validateTin(party.tin, role, p("TIN")));

  if (!party.registrationNumber) {
    issues.push(
      err(
        `${role.toUpperCase()}-REGNO`,
        `${role} registration number (BRN / NRIC / Passport / Army) is mandatory.`,
        p("RegistrationNumber")
      )
    );
  } else if (party.registrationScheme) {
    const lengths: Record<string, [number, number]> = {
      NRIC: [1, 12],
      PASSPORT: [1, 12],
      BRN: [1, 20],
      ARMY: [1, 12],
    };
    const [, max] = lengths[party.registrationScheme] ?? [1, 300];
    if (party.registrationNumber.length > max) {
      issues.push(
        warn(
          `${role.toUpperCase()}-REGNO-LENGTH`,
          `${role} ${party.registrationScheme} "${party.registrationNumber}" is longer than the expected ${max} characters.`,
          p("RegistrationNumber")
        )
      );
    }
  }

  if (party.sstRegistrationNumber && party.sstRegistrationNumber !== "NA") {
    const parts = party.sstRegistrationNumber.split(";");
    if (parts.length > 2) {
      issues.push(
        err(
          `${role.toUpperCase()}-SST-COUNT`,
          `${role} SST registration number lists ${parts.length} values; a maximum of two, separated by ";", is allowed.`,
          p("SstRegistrationNumber")
        )
      );
    }
    if (/[^A-Za-z0-9\-;]/.test(party.sstRegistrationNumber)) {
      issues.push(
        warn(
          `${role.toUpperCase()}-SST-CHARS`,
          `${role} SST registration number contains characters other than letters, digits, "-" and ";".`,
          p("SstRegistrationNumber")
        )
      );
    }
  }

  if (opts.requireMsic) {
    if (!party.msicCode) {
      issues.push(err("SUPPLIER-MSIC-MISSING", "Supplier MSIC code is mandatory.", p("MsicCode")));
    } else if (!MSIC_RE.test(party.msicCode)) {
      issues.push(
        err(
          "SUPPLIER-MSIC-FORMAT",
          `Supplier MSIC code "${party.msicCode}" must be exactly 5 digits.`,
          p("MsicCode")
        )
      );
    }
    if (!party.msicDescription) {
      issues.push(
        err(
          "SUPPLIER-MSIC-DESC-MISSING",
          "Supplier business activity description (MSIC name attribute) is mandatory.",
          p("MsicDescription")
        )
      );
    }
  }

  if (!party.address) {
    issues.push(err(`${role.toUpperCase()}-ADDRESS`, `${role} address is mandatory.`, p("Address")));
  } else {
    if (!party.address.addressLines.length || !party.address.addressLines[0]) {
      issues.push(
        err(`${role.toUpperCase()}-ADDRESS-LINE0`, `${role} address line 0 is mandatory.`, p("Address.Line0"))
      );
    }
    if (!party.address.cityName) {
      issues.push(err(`${role.toUpperCase()}-CITY`, `${role} city name is mandatory.`, p("Address.CityName")));
    }
    if (!party.address.state) {
      issues.push(err(`${role.toUpperCase()}-STATE`, `${role} state code is mandatory.`, p("Address.State")));
    } else if (!(party.address.state in STATE_CODES)) {
      issues.push(
        err(
          `${role.toUpperCase()}-STATE-CODE`,
          `${role} state code "${party.address.state}" is not a recognised MyInvois state code.`,
          p("Address.State")
        )
      );
    }
    if (!party.address.countryCode) {
      issues.push(err(`${role.toUpperCase()}-COUNTRY`, `${role} country code is mandatory.`, p("Address.Country")));
    } else if (!COUNTRY_CODES.has(party.address.countryCode)) {
      issues.push(
        err(
          `${role.toUpperCase()}-COUNTRY-CODE`,
          `${role} country code "${party.address.countryCode}" is not a recognised ISO 3166-1 alpha-3 code.`,
          p("Address.Country")
        )
      );
    }
  }

  if (opts.requireContact) {
    if (!party.phone) {
      issues.push(err(`${role.toUpperCase()}-PHONE`, `${role} contact number is mandatory.`, p("Phone")));
    } else if (party.phone !== "NA" && !PHONE_RE.test(party.phone)) {
      issues.push(
        warn(
          `${role.toUpperCase()}-PHONE-FORMAT`,
          `${role} contact number "${party.phone}" does not look like an E.164-style number.`,
          p("Phone")
        )
      );
    }
  }

  if (party.email && !EMAIL_RE.test(party.email)) {
    issues.push(
      warn(`${role.toUpperCase()}-EMAIL-FORMAT`, `${role} email "${party.email}" does not look like a valid email address.`, p("Email"))
    );
  }

  return issues;
}
