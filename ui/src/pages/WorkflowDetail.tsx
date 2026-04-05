import { useEffect, useState } from "react";
import { useParams } from "@/lib/router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { mastraApi } from "../api/mastra";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { GitBranch, Play, RefreshCw } from "lucide-react";

export function WorkflowDetail() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [inputJson, setInputJson] = useState("{}");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Workflows", href: "/workflows" },
      { label: workflowId ?? "" },
    ]);
  }, [setBreadcrumbs, workflowId]);

  const { data: workflowsMap, isLoading } = useQuery({
    queryKey: ["mastra", "workflows"],
    queryFn: () => mastraApi.listWorkflows(),
  });

  const workflow = workflowsMap?.[workflowId ?? ""];

  const { data: runStatus, refetch: refetchRun } = useQuery({
    queryKey: ["mastra", "workflow-run", workflowId, activeRunId],
    queryFn: () => mastraApi.getWorkflowRun(workflowId!, activeRunId!),
    enabled: !!workflowId && !!activeRunId,
    refetchInterval: activeRunId ? 3000 : false,
  });

  const runMutation = useMutation({
    mutationFn: async (inputData: Record<string, unknown>) =>
      mastraApi.startWorkflow(workflowId!, inputData),
    onSuccess: (result) => {
      pushToast({ title: "Workflow started", body: `Run ID: ${result.runId ?? "started"}` });
      setRunDialogOpen(false);
      if (result.runId) setActiveRunId(result.runId);
    },
    onError: (err) => {
      pushToast({ title: "Failed", body: err instanceof Error ? err.message : "Unknown error", tone: "error" });
    },
  });

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (!workflow) return <EmptyState icon={GitBranch} message={`Workflow "${workflowId}" not found`} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{workflow.name ?? workflowId}</h2>
          {workflow.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{workflow.description}</p>
          )}
          <p className="text-xs text-muted-foreground/60 font-mono mt-1">{workflow.id}</p>
        </div>
        <Button
          onClick={() => {
            setInputJson("{}");
            setRunDialogOpen(true);
          }}
        >
          <Play className="h-3.5 w-3.5 mr-1.5" />
          Run Workflow
        </Button>
      </div>

      {/* Active run status */}
      {activeRunId && runStatus && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Active Run</h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                runStatus.status === "completed" ? "bg-green-500/10 text-green-400" :
                runStatus.status === "suspended" ? "bg-amber-500/10 text-amber-400" :
                runStatus.status === "failed" ? "bg-red-500/10 text-red-400" :
                "bg-blue-500/10 text-blue-400"
              }`}>
                {runStatus.status}
              </span>
              <Button variant="ghost" size="icon-xs" onClick={() => refetchRun()}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground font-mono">Run ID: {activeRunId}</p>

          {/* Step details */}
          {runStatus.steps && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-muted-foreground">Steps</h4>
              {Object.entries(runStatus.steps).map(([stepId, step]) => {
                const status = String(step.status ?? "unknown");
                return (
                  <div key={stepId} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-muted/30 rounded">
                    <span className={`w-2 h-2 rounded-full ${
                      status === "completed" ? "bg-green-400" :
                      status === "suspended" ? "bg-amber-400" :
                      status === "running" ? "bg-blue-400 animate-pulse" :
                      status === "failed" ? "bg-red-400" :
                      "bg-neutral-400"
                    }`} />
                    <span className="font-mono">{stepId}</span>
                    <span className="text-muted-foreground">{status}</span>
                    {status === "suspended" && (
                      <span className="text-amber-400 text-[10px]">Awaiting Approval</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Result */}
          {runStatus.result && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-muted-foreground">Result</h4>
              <pre className="text-xs bg-muted/30 rounded p-2 overflow-auto max-h-48 font-mono">
                {JSON.stringify(runStatus.result, null, 2) as string}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Run Dialog */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run: {workflow.name ?? workflowId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm text-muted-foreground">Input Data (JSON)</label>
            <Textarea
              value={inputJson}
              onChange={(e) => setInputJson(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder='{"key": "value"}'
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                try {
                  runMutation.mutate(JSON.parse(inputJson));
                } catch {
                  pushToast({ title: "Invalid JSON", tone: "error" });
                }
              }}
              disabled={runMutation.isPending}
            >
              {runMutation.isPending ? "Starting..." : "Start Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
