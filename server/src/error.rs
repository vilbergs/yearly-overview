use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    NotFound(String),
    /// The request would overwrite something; `details` says what (e.g. the conflicting days).
    Conflict {
        message: String,
        details: Value,
    },
    Internal(anyhow::Error),
}

impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(error: E) -> Self {
        Self::Internal(error.into())
    }
}

impl AppError {
    /// The message and extra details shown to clients (REST and MCP alike).
    pub fn public(&self) -> (StatusCode, String, Option<&Value>) {
        match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message.clone(), None),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message.clone(), None),
            Self::Conflict { message, details } => {
                (StatusCode::CONFLICT, message.clone(), Some(details))
            }
            Self::Internal(error) => {
                tracing::error!("{error:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong".to_owned(),
                    None,
                )
            }
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message, details) = self.public();
        let body = match details {
            Some(details) => json!({ "error": message, "details": details }),
            None => json!({ "error": message }),
        };
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
