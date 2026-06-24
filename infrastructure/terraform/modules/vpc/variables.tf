variable "name_prefix" { type = string }
variable "vpc_cidr"    { type = string }
variable "azs"         { type = list(string) }

output "vpc_id"            { value = aws_vpc.main.id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids"{ value = aws_subnet.private[*].id }
