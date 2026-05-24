{{- define "wasup-worker.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "wasup-worker.fullname" -}}
{{- printf "%s-%s" (include "wasup-worker.name" .) .Values.instanceId | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "wasup-worker.labels" -}}
app.kubernetes.io/name: {{ include "wasup-worker.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: whatsapp-worker
app.kubernetes.io/managed-by: {{ .Release.Service }}
wasup.ai/org-id: {{ .Values.orgId | quote }}
wasup.ai/instance-id: {{ .Values.instanceId | quote }}
wasup.ai/region-code: {{ .Values.regionCode | quote }}
{{- end -}}
