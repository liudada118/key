import { containsGroupScopeToken, normalizeLicenseFile } from "../shared/licenseScopes";
import { licenseSdkFeatures, normalizeLicenseProduct, type LicenseProductType } from "../shared/licenseProducts";

/** SDK scope uses a new signed field so older desktop clients cannot grant themselves its rights. */
export function createOfflineLicensePayload(params: {
  productType?: LicenseProductType; sensorTypes: string | string[]; deviceLimit: number; expireDate: number; issuedAt: number;
}) {
  const productType = normalizeLicenseProduct(params.productType);
  const scope = productType === "shroom-sdk" ? "all" : normalizeLicenseFile(params.sensorTypes);
  const version = productType === "shroom-sdk" ? 5 : params.deviceLimit ? 4 : containsGroupScopeToken(scope) ? 3 : 2;
  const payload = {
    ...((params.deviceLimit || productType === "shroom-sdk") ? { boundSensorTypes: scope, deviceLimit: params.deviceLimit } : { sensorTypes: scope }),
    ...(productType === "shroom-sdk" ? { productType, sdkFeatures: licenseSdkFeatures(productType) } : {}),
    expireDate: params.expireDate, issuedAt: params.issuedAt, version,
  };
  return { productType, scope, payload, licenseVersion: version };
}
