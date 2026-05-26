variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "db_username" {
  type    = string
  default = "ops"
}

variable "db_password" {
  type      = string
  sensitive = true
}
