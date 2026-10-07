declare namespace App {
  interface Locals {
    /** Set by middleware for /admin requests that passed Cloudflare Access. */
    adminEmail?: string;
  }
}
