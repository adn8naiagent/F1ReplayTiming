# Deploying F1ReplayTiming on Kubernetes

This directory contains production-ready, standard Kubernetes manifests to deploy **F1ReplayTiming** with persistent caching and authentication secret management.

---

## Directory Overview

- **`namespace.yaml`**: Creates the dedicated `f1-timing` namespace.
- **`secret.yaml`**: Holds sensitive credentials (`F1TV_SECRET_KEY`, `F1_USERNAME`, `F1_PASSWORD`).
- **`pvc.yaml`**: Requests a `10Gi` PersistentVolumeClaim for session and index caching mounted at `/app/data`.
- **`deployment.yaml`**: The main workload spec configured with strict non-root security contexts (`runAsUser: 1000`, `fsGroup: 1000`), resource requests/limits, and environment variables (`HOME` & `XDG_CONFIG_HOME`).
- **`service.yaml`**: Exposes the application internally on port `8000` (`ClusterIP`).
- **`ingress.yaml`**: Configures external access and HTTP/HTTPS routing via your cluster Ingress controller.

---

## Prerequisites

1. **Kubernetes Cluster**: Version `1.24+`.
2. **Ingress Controller**: `ingress-nginx`, `traefik`, or any standard Ingress controller.

---

## Quickstart Deployment

### 1. Configure Secrets & Hostnames

Before applying the manifests, update the placeholders in the configuration files:

1. Edit **`secret.yaml`**:
   - Replace `F1TV_SECRET_KEY` with a random 32-byte hex string (generate via `openssl rand -hex 32`).
   - Add your optional F1TV account credentials (`F1_USERNAME` and `F1_PASSWORD`).
2. Edit **`ingress.yaml`**:
   - Change `f1-timing.example.com` to your domain.

### 2. Deploy Manifests

Apply all resources in order with a single command:

```bash
kubectl apply -f k8s/
```

### 3. Verify Deployment

Check the status of the rollout:

```bash
# Verify pod execution
kubectl get pods -n f1-timing

# Check Ingress routing status
kubectl get ingress -n f1-timing
```

---

## Datacenter Network Restrictions & Precomputing Data

Formula 1 actively blocks network requests and logins originating from datacenter IP ranges (such as AWS, Azure, GCP, or cloud provider clusters), which may cause `HTTP 401 Unauthorized` or connection timeout errors when trying to fetch sessions directly online.

To bypass datacenter egress blocks, **precompute and cache session data locally** on a residential IP connection, then transfer the artifacts into the Kubernetes Persistent Volume:

### Step 1: Precompute Session Data Locally

Run the precompute script from your local desktop/laptop:

```bash
# Run locally in the cloned repository
python precompute.py 2024
```

### Step 2: Copy Cached Data to the PVC

Transfer the locally generated `/data` folder directly into the container's persistent storage path (`/app/data`):

```bash
kubectl cp ./data/. f1-timing/$(kubectl get pod -l app.kubernetes.io/name=f1-replay-timing -n f1-timing -o jsonpath='{.items[0].metadata.name}'):/app/data/
```

### Step 3: Confirm Volume Contents

```bash
kubectl exec -it deployment/f1-replay-timing -n f1-timing -- ls -la /app/data
```

Once the precomputed session files are present inside `/app/data`, the service will instantly load and replay sessions directly from disk without hitting F1 network blocks.

---

## Cleanup

To completely remove the application and all associated resources (including stored volume data):

```bash
kubectl delete namespace f1-timing
```
