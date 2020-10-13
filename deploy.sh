#!/usr/bin/env bash
set -e

(cd metadata-storage; npm install)

(cd infra; npm install && cdk bootstrap && npm run deploy)