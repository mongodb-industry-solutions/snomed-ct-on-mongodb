function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function hasAuthFailure(message, code, codeName) {
  if (code === 18 || codeName === "AuthenticationFailed") {
    return true;
  }
  const lower = message.toLowerCase();
  return lower.includes("authentication failed") || lower.includes("bad auth");
}

function hasNetworkFailure(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes("timed out") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("failed to connect") ||
    lower.includes("ip address")
  );
}

export function buildMongoErrorPayload(error) {
  const message = asErrorMessage(error);
  const code = typeof error?.code === "number" ? error.code : undefined;
  const codeName = typeof error?.codeName === "string" ? error.codeName : undefined;
  const name = typeof error?.name === "string" ? error.name : undefined;

  const hints = [];
  if (hasAuthFailure(message, code, codeName)) {
    hints.push("Check MONGODB_URI username/password in .env.local.");
    hints.push("URL-encode special characters in your password (e.g. @, :, /, ?).");
    hints.push("If your Mongo user authenticates on a specific DB, set MONGODB_AUTH_SOURCE (for example: admin or terminology).");
  } else if (hasNetworkFailure(message)) {
    hints.push("Check MongoDB network access or firewall allowlists for your current IP.");
    hints.push("Verify cluster hostname and internet connectivity.");
  }

  return {
    details: message,
    ...(name ? { mongoErrorName: name } : {}),
    ...(typeof code === "number" ? { mongoErrorCode: code } : {}),
    ...(codeName ? { mongoErrorCodeName: codeName } : {}),
    ...(hints.length > 0 ? { hints } : {})
  };
}
