-- K5-09: OIDC providers behind per-provider enabled flags with AES-256-GCM sealed client secrets.
CREATE TABLE "oidc_providers" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issuer_url" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "client_secret_enc" TEXT NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT 'openid profile email',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oidc_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oidc_providers_slug_key" ON "oidc_providers"("slug");
