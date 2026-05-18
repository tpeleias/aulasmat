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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          duration_minutes: number | null
          guardian_name: string | null
          id: string
          lesson_id: string | null
          start_at: string | null
          student_name: string | null
          teacher: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          guardian_name?: string | null
          id?: string
          lesson_id?: string | null
          start_at?: string | null
          student_name?: string | null
          teacher?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          guardian_name?: string | null
          id?: string
          lesson_id?: string | null
          start_at?: string | null
          student_name?: string | null
          teacher?: string | null
        }
        Relationships: []
      }
      block_exceptions: {
        Row: {
          block_id: string
          created_at: string
          exception_date: string
          id: string
        }
        Insert: {
          block_id: string
          created_at?: string
          exception_date: string
          id?: string
        }
        Update: {
          block_id?: string
          created_at?: string
          exception_date?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "block_exceptions_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          block_type: string
          created_at: string
          end_at: string | null
          end_time: string | null
          id: string
          start_at: string | null
          start_time: string | null
          teacher: string
          title: string
          weekday: number | null
        }
        Insert: {
          block_type?: string
          created_at?: string
          end_at?: string | null
          end_time?: string | null
          id?: string
          start_at?: string | null
          start_time?: string | null
          teacher?: string
          title: string
          weekday?: number | null
        }
        Update: {
          block_type?: string
          created_at?: string
          end_at?: string | null
          end_time?: string | null
          id?: string
          start_at?: string | null
          start_time?: string | null
          teacher?: string
          title?: string
          weekday?: number | null
        }
        Relationships: []
      }
      homework: {
        Row: {
          created_at: string
          created_by: string | null
          deadline: string
          description: string | null
          id: string
          status: string
          student_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deadline: string
          description?: string | null
          id?: string
          status?: string
          student_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deadline?: string
          description?: string | null
          id?: string
          status?: string
          student_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          file_path: string
          file_type: string | null
          homework_id: string
          id: string
          student_note: string | null
          submitted_at: string
          teacher_feedback: string | null
        }
        Insert: {
          file_path: string
          file_type?: string | null
          homework_id: string
          id?: string
          student_note?: string | null
          submitted_at?: string
          teacher_feedback?: string | null
        }
        Update: {
          file_path?: string
          file_type?: string | null
          homework_id?: string
          id?: string
          student_note?: string | null
          submitted_at?: string
          teacher_feedback?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "homework"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          address: string | null
          class_summary: string | null
          created_at: string
          duration_minutes: number
          guardian_name: string | null
          id: string
          is_online: boolean
          notes: string | null
          package_type: string
          payment_status: string
          price: number
          start_at: string
          status: string
          student_name: string
          subject: string | null
          teacher: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          class_summary?: string | null
          created_at?: string
          duration_minutes?: number
          guardian_name?: string | null
          id?: string
          is_online?: boolean
          notes?: string | null
          package_type?: string
          payment_status?: string
          price?: number
          start_at: string
          status?: string
          student_name: string
          subject?: string | null
          teacher?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          class_summary?: string | null
          created_at?: string
          duration_minutes?: number
          guardian_name?: string | null
          id?: string
          is_online?: boolean
          notes?: string | null
          package_type?: string
          payment_status?: string
          price?: number
          start_at?: string
          status?: string
          student_name?: string
          subject?: string | null
          teacher?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          allow_student_booking: boolean
          id: number
          payment_link: string | null
          pix_key: string | null
          scarcity_weekday_max: number
          scarcity_weekday_min: number
          scarcity_weekend_max: number
          scarcity_weekend_min: number
          show_payment_info_to_students: boolean
          slot_minutes: number
          whatsapp_mayara: string | null
          whatsapp_thiago: string | null
          work_end: string
          work_start: string
        }
        Insert: {
          allow_student_booking?: boolean
          id?: number
          payment_link?: string | null
          pix_key?: string | null
          scarcity_weekday_max?: number
          scarcity_weekday_min?: number
          scarcity_weekend_max?: number
          scarcity_weekend_min?: number
          show_payment_info_to_students?: boolean
          slot_minutes?: number
          whatsapp_mayara?: string | null
          whatsapp_thiago?: string | null
          work_end?: string
          work_start?: string
        }
        Update: {
          allow_student_booking?: boolean
          id?: number
          payment_link?: string | null
          pix_key?: string | null
          scarcity_weekday_max?: number
          scarcity_weekday_min?: number
          scarcity_weekend_max?: number
          scarcity_weekend_min?: number
          show_payment_info_to_students?: boolean
          slot_minutes?: number
          whatsapp_mayara?: string | null
          whatsapp_thiago?: string | null
          work_end?: string
          work_start?: string
        }
        Relationships: []
      }
      student_materials: {
        Row: {
          created_at: string
          file_path: string
          file_type: string | null
          id: string
          student_id: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_path: string
          file_type?: string | null
          id?: string
          student_id: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_path?: string
          file_type?: string | null
          id?: string
          student_id?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_materials_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          address: string | null
          created_at: string
          guardian_name: string | null
          id: string
          must_change_password: boolean
          student_name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          guardian_name?: string | null
          id?: string
          must_change_password?: boolean
          student_name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          guardian_name?: string | null
          id?: string
          must_change_password?: boolean
          student_name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      teachers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          guardian_name: string | null
          id: string
          kind: string
          lesson_id: string | null
          student_name: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          guardian_name?: string | null
          id?: string
          kind: string
          lesson_id?: string | null
          student_name: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          guardian_name?: string | null
          id?: string
          kind?: string
          lesson_id?: string | null
          student_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_student: {
        Args: never
        Returns: {
          address: string | null
          created_at: string
          guardian_name: string | null
          id: string
          must_change_password: boolean
          student_name: string
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "students"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_busy_ranges: {
        Args: { _from: string; _to: string }
        Returns: {
          end_at: string
          start_at: string
        }[]
      }
      get_busy_ranges_by_teacher: {
        Args: { _from: string; _teacher: string; _to: string }
        Returns: {
          end_at: string
          start_at: string
        }[]
      }
      get_recurring_blocks: {
        Args: never
        Returns: {
          end_time: string
          start_time: string
          weekday: number
        }[]
      }
      get_recurring_blocks_by_teacher: {
        Args: { _teacher: string }
        Returns: {
          end_time: string
          exceptions: string[]
          id: string
          start_time: string
          weekday: number
        }[]
      }
      get_recurring_blocks_v2: {
        Args: never
        Returns: {
          end_time: string
          exceptions: string[]
          id: string
          start_time: string
          weekday: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "student"
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
      app_role: ["admin", "user", "student"],
    },
  },
} as const
