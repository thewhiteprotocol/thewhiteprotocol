"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-4">
          <Card className="glass-card max-w-md border-white/10">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <AlertTriangle className="h-12 w-12 text-red-400" />
              <h3 className="mt-4 text-lg font-semibold">Something went wrong</h3>
              <p className="mt-2 text-sm text-zinc-400">
                {this.state.error?.message || "An unexpected error occurred."}
              </p>
              <Button
                onClick={() => this.setState({ hasError: false })}
                className="mt-6 bg-emerald-600 hover:bg-emerald-700"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
