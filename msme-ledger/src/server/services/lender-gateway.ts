// src/server/services/lender-gateway.ts
// Integration point for FUTURE authorised lending partners. v1 ships no live integration:
// the default gateway records that nothing was sent, so the app never pretends a lender
// received an application.
import "server-only";

export interface LoanApplicationPayload {
  applicantRef: string; // anonymised id, e.g. MSME-1A2B3C4D
  productExternalId: string;
  requestedAmount: string;
  creditProfile: Record<string, unknown>;
  consentGivenAt: string;
}

export interface LenderGatewayResult {
  delivered: boolean;
  externalReference: string | null;
  message: string;
}

export interface LenderGateway {
  readonly partnerName: string;
  submitApplication(payload: LoanApplicationPayload): Promise<LenderGatewayResult>;
}

export class NotConnectedGateway implements LenderGateway {
  constructor(readonly partnerName: string) {}
  async submitApplication(): Promise<LenderGatewayResult> {
    return { delivered: false, externalReference: null, message: `No live integration with ${this.partnerName} is configured.` };
  }
}

/** Register real, authorised gateways here (keyed by LendingPartner.id) once agreements exist. */
const registry = new Map<string, LenderGateway>();

export function gatewayFor(partnerId: string, partnerName: string): LenderGateway {
  return registry.get(partnerId) ?? new NotConnectedGateway(partnerName);
}
