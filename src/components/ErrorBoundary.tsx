import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="text-center max-w-md">
            <h1 className="text-2xl font-bold mb-2 text-foreground">Something went wrong</h1>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error?.message}</p>
            <Button onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = "/"; }}>
              Go Home
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
