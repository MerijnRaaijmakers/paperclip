import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { mastraApi, type MastraWorkflow } from "../api/mastra";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GitBranch, Play } from "lucide-react";

export function Workflows() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<{ id: string; name: string } | null>(null);
  const [inputJson, setInputJson] = useState("{}");

  useEffect(() => {
    setBreadcrumbs([{ label: "Workflows" }]);
  }, [setBreadcrumbs]);

  const { data: workflowsMap, isLoading, error } = useQuery({
    queryKey: ["mastra", "workflows"],
    queryFn: () => mastraApi.listWorkflows(),
  });

  const runMutation = useMutation({
    mutationFn: async ({ workflowId, inputData }: { workflowId: string; inputData: Record<string, unknown> }) =>
      mastraApi.startWorkflow(workflowId, inputData),
    onSuccess: (result) => {
      pushToast({ title: "Workflow started", body: `Run ID: ${result.runId ?? "started"}` });
      setRunDialogOpen(false);
    },
    onError: (err) => {
      pushToast({ title: "Failed to start workflow", body: err instanceof Error ? err.message : "Unknown error", tone: "error" });
    },
  });

  const workflows = workflowsMap
    ? Object.entries(workflowsMap).map(([key, w]) => ({ key, ...w }))
    : [];

  if (isLoading) return <PageSkeleton variant="list" />;

  if (error) {
    return (
      <EmptyState
        icon={GitBranch}
        message={`Failed to load workflows: ${error instanceof Error ? error.message : "Unknown error"}`}
      />
    );
  }

  if (workflows.length === 0) {
    return <EmptyState icon={GitBranch} message="No workflows found. Make sure Mastra is running." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Workflows</h2>
        <span className="text-xs text-muted-foreground">{workflows.length} workflows</span>
      </div>

      <div className="border border-border divide-y divide-border">
        {workflows.map(({ key, id, name, description }) => (
          <div
            key={key}
            className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors cursor-pointer"
            onClick={() => navigate(`/workflows/${key}`)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">{name ?? key}</span>
              </div>
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5 ml-6 truncate">{description}</p>
              )}
              <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5 ml-6">{id}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedWorkflow({ id: key, name: name ?? key });
                setInputJson("{}");
                setRunDialogOpen(true);
              }}
            >
              <Play className="h-3 w-3 mr-1.5" />
              Run
            </Button>
          </div>
        ))}
      </div>

      {/* Run Workflow Dialog */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Workflow: {selectedWorkflow?.name}</DialogTitle>
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
            <Button variant="outline" onClick={() => setRunDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedWorkflow) return;
                try {
                  const parsed = JSON.parse(inputJson);
                  runMutation.mutate({ workflowId: selectedWorkflow.id, inputData: parsed });
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
