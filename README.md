# IT-01 and IT-02 Combined Flow Diagram

This diagram shows how XPOLL moves from code changes to a live production system.

```mermaid
flowchart TB

step1["1. Code changes<br/>in XPOLL repositories"]
step2["2. Push to<br/>main branch"]
step3["3. GitHub Actions<br/>builds and release workflows"]
step4["4. Images published to<br/>DigitalOcean Container<br/>Registry"]
step5["5. Kubernetes rollout<br/>in the xpoll namespace"]
step6["6. NGINX Ingress<br/>and TLS routing"]
step7["7. Live XPOLL<br/>apps and APIs"]
step8["8. Internal processing<br/>and support services"]

step1 --> step2 --> step3 --> step4 --> step5 --> step6 --> step7 --> step8

repo_list["xpoll-server<br/>xpoll-user<br/>xpoll-admin<br/>xpoll-landing-102025<br/>xpoll-aptos-transfer-service"]
step1 --- repo_list

domain_examples["xpoll.io<br/>app.xpoll.io<br/>admin.xpoll.io<br/>api.xpoll.io<br/>api-aptos-transfer-<br/>prod.xpoll.io"]
step6 --- domain_examples

public_apps["Landing site<br/>User app<br/>Admin app"]
public_apis["Main API<br/>Aptos transfer API"]
step7 --- public_apps
step7 --- public_apis

internal_jobs["Queue worker<br/>EVM listener<br/>Strain listener<br/>Aptos transfer worker"]
data_services["MongoDB<br/>Redis"]
trigger_runtime["Trigger.dev tasks<br/>run separately from<br/>the image rollout path"]
step8 --- internal_jobs
step8 --- data_services
step8 --- trigger_runtime

evm_note["Production EVM listener<br/>image publish does not<br/>automatically restart<br/>the deployment"]
step5 -.-> evm_note

classDef main fill:#dbeafe,stroke:#1d4ed8,color:#0f172a,stroke-width:1.5px;
classDef infra fill:#ccfbf1,stroke:#0f766e,color:#0f172a,stroke-width:1.5px;
classDef public fill:#dcfce7,stroke:#15803d,color:#0f172a,stroke-width:1.5px;
classDef support fill:#e5e7eb,stroke:#6b7280,color:#111827,stroke-width:1.5px;
classDef internal fill:#fef3c7,stroke:#b45309,color:#0f172a,stroke-width:1.5px;
classDef note fill:#ffe4e6,stroke:#be123c,color:#881337,stroke-width:1.5px,stroke-dasharray: 4 2;

class step1,step2,step3,step4 main;
class step5,step6 infra;
class step7,public_apps,public_apis public;
class repo_list,domain_examples,data_services support;
class step8,internal_jobs,trigger_runtime internal;
class evm_note note;
```

## Reading Notes

- The numbered path shows the main production journey from code change to live XPOLL system.
- The same release pattern also exists for development through the `dev` branch.
- GitHub Actions builds and publishes deployable images, and Kubernetes rolls out the updated services inside the `xpoll` namespace.
- Public websites and APIs are exposed through `NGINX Ingress` and TLS routing.
- Workers, listeners, databases, and Trigger.dev support the live platform behind the scenes, and the production EVM listener publish path does not automatically restart its deployment.
