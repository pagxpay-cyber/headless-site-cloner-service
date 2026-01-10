# Headless Site Cloner Service (Chromium / SPA) — Deploy em VPS (Ubuntu 24.04 + CloudPanel)

Este repositório contém o **Headless Site Cloner Service**, um serviço Node.js com **Chromium headless** (via Puppeteer) para renderizar páginas (incluindo **SPA**) e gerar um **site estático** (ZIP + pasta extraída), semelhante ao comportamento de ferramentas como “save website to zip”.

A documentação abaixo descreve como instalar e publicar o serviço em um **servidor próprio** (VPS) rodando **Ubuntu 24.04 + CloudPanel**, usando **Docker** e **Reverse Proxy** no Nginx do CloudPanel.

> ✅ **Observação:** Este README considera **domínio próprio** (ex.: `cloner.seudominio.com`) e **não subdomínio**.

---

## Sumário

- [Pré-requisitos](#pré-requisitos)
- [Arquitetura recomendada](#arquitetura-recomendada)
- [1) Preparar a VPS](#1-preparar-a-vps)
- [2) Instalar Docker + Compose](#2-instalar-docker--compose)
- [3) Instalar o projeto no servidor](#3-instalar-o-projeto-no-servidor)
- [4) Configurar variáveis de ambiente](#4-configurar-variáveis-de-ambiente)
- [5) Subir com Docker Compose](#5-subir-com-docker-compose)
- [6) Publicar com domínio próprio (Cloudflare + CloudPanel Reverse Proxy)](#6-publicar-com-domínio-próprio-cloudflare--cloudpanel-reverse-proxy)
- [7) Testes](#7-testes)
- [8) Operação (start/stop/logs/update)](#8-operação-startstoplogsupdate)
- [9) Hardening básico (recomendado)](#9-hardening-básico-recomendado)
- [10) Troubleshooting](#10-troubleshooting)
- [Checklist de Deploy](#checklist-de-deploy)

---

## Pré-requisitos

- VPS com **Ubuntu 24.04** e **CloudPanel** instalado
- Acesso SSH como `root` (ou usuário com sudo)
- Um **domínio próprio** apontando para o IP da VPS (via Cloudflare ou provedor DNS)
- Recomendado: mínimo **1 vCPU / 4 GB RAM** (funciona com `CONCURRENCY=1`)

---

## Arquitetura recomendada

**Por segurança e estabilidade:**

- Serviço roda via **Docker**
- Porta do serviço **não é exposta** para a internet
- O Docker “bind” acontece apenas em **localhost (`127.0.0.1`)**
- O acesso público ocorre via **Reverse Proxy** do CloudPanel (Nginx) com **SSL Let’s Encrypt**

Fluxo:

```
Internet (HTTPS) -> CloudPanel/Nginx (Reverse Proxy) -> http://127.0.0.1:PORT -> Container (Node + Chromium)
```

---

## 1) Preparar a VPS

### 1.1 Atualizar sistema
```bash
apt update && apt -y upgrade
```

### 1.2 Instalar dependências base
```bash
apt -y install ca-certificates curl gnupg lsb-release ufw unzip git
```

---

## 2) Instalar Docker + Compose

### 2.1 Adicionar repositório do Docker
```bash
install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg |   gpg --dearmor -o /etc/apt/keyrings/docker.gpg

chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
```

### 2.2 Instalar Docker Engine e Compose plugin
```bash
apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 2.3 Habilitar e iniciar o Docker
```bash
systemctl enable --now docker
```

### 2.4 Testar instalação
```bash
docker --version
docker compose version
docker run --rm hello-world
```

---

## 3) Instalar o projeto no servidor

### 3.1 Criar diretório padrão
```bash
mkdir -p /opt/headless-site-cloner
cd /opt/headless-site-cloner
```

### 3.2 Clonar o repositório (recomendado)
```bash
git clone SEU_REPO_GIT .
```

> Alternativa (se você fizer upload ZIP): copie o zip para `/opt/headless-site-cloner/` e extraia com `unzip`.

---

## 4) Configurar variáveis de ambiente

### 4.1 Escolher uma porta (IMPORTANTE)
O CloudPanel costuma usar a porta **8080**, então use outra para o serviço (ex.: **8088**).

Verifique se está livre:
```bash
ss -ltnp | grep ':8088' || echo "8088 livre"
```

### 4.2 Criar `.env`
No diretório do projeto:
```bash
cat > .env <<'EOF'
PORT=8088
API_KEY=COLOQUE_SUA_CHAVE_AQUI
ALLOWED_HOSTS=example.com,www.example.com
CONCURRENCY=1
TIMEOUT_MS=90000
MAX_PAGES=60
MAX_ASSETS=300
EOF
```

**Recomendações:**
- `API_KEY`: use uma chave forte (ideal: 32+ caracteres)
- `ALLOWED_HOSTS`: restrinja aos domínios que você autoriza clonar
- `CONCURRENCY=1`: recomendado em VPS com 1 vCPU
- Ajuste `MAX_PAGES/MAX_ASSETS/TIMEOUT_MS` conforme necessidade

---

## 5) Subir com Docker Compose

### 5.1 Criar `docker-compose.yml`
```bash
cat > docker-compose.yml <<'EOF'
services:
  cloner:
    build: .
    container_name: headless-site-cloner
    env_file: .env
    restart: unless-stopped
    ports:
      - "127.0.0.1:8088:8088"
    shm_size: "512mb"
EOF
```

> ✅ `127.0.0.1:8088:8088` expõe a porta **apenas localmente**, não para a internet.

### 5.2 Build e start
```bash
docker compose up -d --build
```

### 5.3 Logs
```bash
docker compose logs -f --tail=150
```

---

## 6) Publicar com domínio próprio (Cloudflare + CloudPanel Reverse Proxy)

### 6.1 DNS no Cloudflare (ou seu provedor)
Crie um registro DNS apontando o domínio para o IP da VPS.

Exemplo:
- Type: `A`
- Name: `cloner` **ou** `@` (dependendo se é raiz ou domínio específico)
- Content: `IP_DA_VPS`
- Proxy: **Proxied (laranja)** (recomendado)

**Se for domínio raiz**, use `@` no campo “Name”.

### 6.2 CloudPanel — criar site Reverse Proxy
No CloudPanel:
1) **Add Site**
2) Tipo: **Reverse Proxy**
3) Domain: `cloner.seudominio.com` (ou o domínio que você apontou)
4) Upstream/Target: `http://127.0.0.1:8088`

### 6.3 SSL (Let’s Encrypt)
No site criado no CloudPanel:
- Ative **Let’s Encrypt** para o domínio

---

## 7) Testes

### 7.1 Teste local (na VPS)
```bash
curl -i http://127.0.0.1:8088/health
curl -i http://127.0.0.1:8088/
```

### 7.2 Teste público (no navegador)
Acesse:
- `https://cloner.seudominio.com/health`

Deve retornar **200 OK**.

---

## 8) Operação (start/stop/logs/update)

### 8.1 Ver containers
```bash
docker ps
```

### 8.2 Reiniciar serviço
```bash
cd /opt/headless-site-cloner
docker compose restart
```

### 8.3 Parar serviço
```bash
cd /opt/headless-site-cloner
docker compose down
```

### 8.4 Atualizar código (Git) + rebuild
```bash
cd /opt/headless-site-cloner
git pull
docker compose up -d --build
```

### 8.5 Logs do container
```bash
docker logs headless-site-cloner --tail=200
```

---

## 9) Hardening básico (recomendado)

### 9.1 Firewall (UFW)
```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

> Não é necessário liberar a porta 8088, pois ela está bindada em `127.0.0.1`.

### 9.2 Boas práticas
- Mantenha `ALLOWED_HOSTS` restrito
- Use `API_KEY` forte
- Comece com `CONCURRENCY=1`
- Evite expor a API sem autenticação
- Monitore RAM/CPU em clones maiores

---

## 10) Troubleshooting

### 10.1 Erro: `address already in use`
A porta escolhida está ocupada.

Checar:
```bash
ss -ltnp | grep ':8088'
```

Troque para outra porta (ex.: 8090) e ajuste:
- `.env` (`PORT=8090`)
- `docker-compose.yml` (`127.0.0.1:8090:8090`)
- Upstream do CloudPanel (`http://127.0.0.1:8090`)

Rebuild:
```bash
docker compose down
docker compose up -d --build
```

---

### 10.2 `/health` falha localmente
Ver logs:
```bash
docker compose logs -f --tail=200
```

Cheque se o app usa `process.env.PORT` para bindar.

---

### 10.3 Reverse Proxy ok, mas SSL não emite
- Confirme DNS apontando corretamente para o IP
- Aguarde propagação
- Verifique Cloudflare Proxy e configurações do CloudPanel

---

## Checklist de Deploy

- [ ] VPS atualizada (Ubuntu 24.04)
- [ ] Docker + Compose instalados e testados
- [ ] Projeto em `/opt/headless-site-cloner`
- [ ] Porta escolhida livre (ex.: 8088)
- [ ] `.env` criado (API_KEY forte, ALLOWED_HOSTS correto)
- [ ] `docker compose up -d --build` ok
- [ ] `curl http://127.0.0.1:PORT/health` ok
- [ ] DNS do domínio aponta para IP da VPS
- [ ] CloudPanel site Reverse Proxy criado com upstream `127.0.0.1:PORT`
- [ ] SSL Let’s Encrypt ativo
- [ ] `https://SEU_DOMINIO/health` ok

---

## Licença / Uso

Use apenas em domínios que você tem autorização para clonar e respeite os termos de uso/robots.txt quando aplicável.
