export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      guest_analyses: {
        Row: {
          analysis_result: Json
          ats_score: number | null
          claimed_by: string | null
          content_hash: string
          created_at: string | null
          expires_at: string | null
          file_name: string
          id: string
          interview_probability: number | null
          keyword_strength_score: number | null
          market_competitiveness: string | null
          quantification_score: number | null
          recruiter_scan_score: number | null
          resume_text: string | null
          resume_type: string | null
          session_token: string
          structure_score: number | null
        }
        Insert: {
          analysis_result: Json
          ats_score?: number | null
          claimed_by?: string | null
          content_hash: string
          created_at?: string | null
          expires_at?: string | null
          file_name: string
          id?: string
          interview_probability?: number | null
          keyword_strength_score?: number | null
          market_competitiveness?: string | null
          quantification_score?: number | null
          recruiter_scan_score?: number | null
          resume_text?: string | null
          resume_type?: string | null
          session_token: string
          structure_score?: number | null
        }
        Update: {
          analysis_result?: Json
          ats_score?: number | null
          claimed_by?: string | null
          content_hash?: string
          created_at?: string | null
          expires_at?: string | null
          file_name?: string
          id?: string
          interview_probability?: number | null
          keyword_strength_score?: number | null
          market_competitiveness?: string | null
          quantification_score?: number | null
          recruiter_scan_score?: number | null
          resume_text?: string | null
          resume_type?: string | null
          session_token?: string
          structure_score?: number | null
        }
        Relationships: []
      }
      otp_codes: {
        Row: {
          attempts: number
          created_at: string
          expires_at: string
          id: string
          locked_until: string | null
          otp_hash: string
          used: boolean
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          expires_at: string
          id?: string
          locked_until?: string | null
          otp_hash: string
          used?: boolean
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          expires_at?: string
          id?: string
          locked_until?: string | null
          otp_hash?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          payment_type: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          resume_analysis_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          payment_type: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          resume_analysis_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          payment_type?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          resume_analysis_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_resume_analysis_id_fkey"
            columns: ["resume_analysis_id"]
            isOneToOne: false
            referencedRelation: "resume_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          early_bird_active: boolean | null
          early_bird_expiry_date: string | null
          email: string | null
          first_time_early_bird_used: boolean | null
          first_time_fix_used: boolean | null
          id: string
          total_payments: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          early_bird_active?: boolean | null
          early_bird_expiry_date?: string | null
          email?: string | null
          first_time_early_bird_used?: boolean | null
          first_time_fix_used?: boolean | null
          id?: string
          total_payments?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          early_bird_active?: boolean | null
          early_bird_expiry_date?: string | null
          email?: string | null
          first_time_early_bird_used?: boolean | null
          first_time_fix_used?: boolean | null
          id?: string
          total_payments?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resume_analyses: {
        Row: {
          analysis_result: Json | null
          ats_score: number | null
          content_hash: string
          created_at: string
          file_name: string
          id: string
          interview_probability: number | null
          is_paid_fix_unlocked: boolean | null
          keyword_strength_score: number | null
          market_competitiveness: string | null
          paid_fix_unlocked_at: string | null
          quantification_score: number | null
          recruiter_scan_score: number | null
          resume_text: string | null
          resume_type: string | null
          structure_score: number | null
          user_id: string
        }
        Insert: {
          analysis_result?: Json | null
          ats_score?: number | null
          content_hash: string
          created_at?: string
          file_name: string
          id?: string
          interview_probability?: number | null
          is_paid_fix_unlocked?: boolean | null
          keyword_strength_score?: number | null
          market_competitiveness?: string | null
          paid_fix_unlocked_at?: string | null
          quantification_score?: number | null
          recruiter_scan_score?: number | null
          resume_text?: string | null
          resume_type?: string | null
          structure_score?: number | null
          user_id: string
        }
        Update: {
          analysis_result?: Json | null
          ats_score?: number | null
          content_hash?: string
          created_at?: string
          file_name?: string
          id?: string
          interview_probability?: number | null
          is_paid_fix_unlocked?: boolean | null
          keyword_strength_score?: number | null
          market_competitiveness?: string | null
          paid_fix_unlocked_at?: string | null
          quantification_score?: number | null
          recruiter_scan_score?: number | null
          resume_text?: string | null
          resume_type?: string | null
          structure_score?: number | null
          user_id?: string
        }
        Relationships: []
      }
      resume_score_cache: {
        Row: {
          analysis_result: Json
          ats_score: number
          content_hash: string
          created_at: string
          interview_probability: number
          keyword_strength_score: number
          market_competitiveness: string | null
          quantification_score: number
          recruiter_scan_score: number
          resume_type: string | null
          structure_score: number
        }
        Insert: {
          analysis_result: Json
          ats_score: number
          content_hash: string
          created_at?: string
          interview_probability: number
          keyword_strength_score: number
          market_competitiveness?: string | null
          quantification_score: number
          recruiter_scan_score: number
          resume_type?: string | null
          structure_score: number
        }
        Update: {
          analysis_result?: Json
          ats_score?: number
          content_hash?: string
          created_at?: string
          interview_probability?: number
          keyword_strength_score?: number
          market_competitiveness?: string | null
          quantification_score?: number
          recruiter_scan_score?: number
          resume_type?: string | null
          structure_score?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          device_info: string | null
          id: string
          is_active: boolean
          last_active_at: string
          session_token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_info?: string | null
          id?: string
          is_active?: boolean
          last_active_at?: string
          session_token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_info?: string | null
          id?: string
          is_active?: boolean
          last_active_at?: string
          session_token?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      expire_early_bird_subscriptions: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
