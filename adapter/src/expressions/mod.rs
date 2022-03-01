use crate::debug_protocol::Expressions;

#[macro_use]
pub mod prelude {
    use nom::{
        character::complete::{digit1, space0},
        error::ParseError,
        sequence::delimited,
        IResult,
    };
    pub type Span<'a> = &'a str;

    pub fn ws<'a, F: 'a, O, E: ParseError<Span<'a>>>(parser: F) -> impl FnMut(Span<'a>) -> IResult<Span<'a>, O, E>
    where
        F: Fn(Span<'a>) -> IResult<Span<'a>, O, E>,
    {
        delimited(space0, parser, space0)
    }

    pub fn unsigned(input: Span) -> IResult<Span, u32> {
        let (rest, s) = digit1(input)?;
        Ok((rest, parse_int::parse::<u32>(s).unwrap()))
    }

    #[cfg(test)]
    macro_rules! assert_matches(($e:expr, $p:pat) => { let e = $e; assert!(matches!(e, $p), "{:?} !~ {}", e, stringify!($p)) });
}

mod expression_format;
mod hit_condition;
mod preprocess;
mod qualified_ident;

pub use expression_format::{get_expression_format, FormatSpec};
pub use hit_condition::{parse_hit_condition, HitCondition};
pub use preprocess::{preprocess_python_expr, preprocess_simple_expr};

#[derive(Debug)]
pub enum PreparedExpression {
    Native(String),
    Simple(String),
    Python(String),
}

// Parse expression type and preprocess it.
pub fn prepare(expression: &str, default_type: Expressions) -> PreparedExpression {
    let (expr, ty) = get_expression_type(expression, default_type);
    match ty {
        Expressions::Native => PreparedExpression::Native(expr.to_owned()),
        Expressions::Simple => PreparedExpression::Simple(preprocess_simple_expr(expr)),
        Expressions::Python => PreparedExpression::Python(preprocess_python_expr(expr)),
    }
}

// Same as prepare(), but also parses formatting options at the end of expression,
// for example, `value,x` to format value as hex or `ptr,[50]` to interpret `ptr` as an array of 50 elements.
pub fn prepare_with_format(
    expression: &str,
    default_type: Expressions,
) -> Result<(PreparedExpression, Option<FormatSpec>), String> {
    let (expr, ty) = get_expression_type(expression, default_type);
    let (expr, format) = get_expression_format(expr)?;
    let pp_expr = match ty {
        Expressions::Native => PreparedExpression::Native(expr.to_owned()),
        Expressions::Simple => PreparedExpression::Simple(preprocess_simple_expr(expr)),
        Expressions::Python => PreparedExpression::Python(preprocess_python_expr(expr)),
    };
    Ok((pp_expr, format))
}

fn get_expression_type<'a>(expr: &'a str, default_type: Expressions) -> (&'a str, Expressions) {
    if expr.starts_with("/nat ") {
        (&expr[5..], Expressions::Native)
    } else if expr.starts_with("/py ") {
        (&expr[4..], Expressions::Python)
    } else if expr.starts_with("/se ") {
        (&expr[4..], Expressions::Simple)
    } else {
        (expr, default_type)
    }
}
